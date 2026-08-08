// The engine. Digging, marking, clearing, the bird in the cage, the clock and
// the terminal checks.
//
// Nothing in here touches the DOM or a canvas, which is what lets the test
// bots play the real game headlessly — every balance number in tests/bot.test.js
// comes from this file rather than from a model of it.
//
// Two decisions worth knowing before reading:
//
// The board is not dealt until the first dig. That is what makes the promise
// "your first tap is always safe, and the board is always solvable from it"
// possible at all: the opening square is an input to the generator, not a
// gamble taken against a board that already exists. The Daily Seam is the one
// exception, because a shared board has to have a shared opening too, so it
// arrives already dealt and already dug.
//
// The canary is one resource with two uses. Send it ahead and it lands on a
// square you could have proved safe yourself; leave it in the cage and it takes
// the hit the first time you tap gas, costing you fifteen seconds instead of
// the shift. Both spend the same bird, which is the actual decision: insurance
// or information.

const CANARY_PENALTY = 15;   // seconds a dead canary costs you

const Game = {
  events: [],       // drained by the renderer; the engine never draws
  active: false,    // set from the screen change hook

  start(cfg) {
    this.mode = cfg.mode || "shift";           // shift | free | daily
    this.shiftIdx = cfg.shiftIdx ?? -1;
    this.sizeId = cfg.sizeId || null;
    this.date = cfg.date || null;

    this.cols = cfg.cols; this.rows = cfg.rows; this.n = cfg.cols * cfg.rows;
    this.mines = cfg.mines;
    this.canariesStart = cfg.canaries ?? 1;
    this.canaries = this.canariesStart;
    this.seed = cfg.seed ?? Math.floor(Math.random() * 0xffffffff);

    this.board = null;
    this.rev = new Uint8Array(this.n);
    this.mk = new Uint8Array(this.n);
    this.revealed = 0;
    this.marked = 0;

    this.state = "ready";      // ready | playing | won | lost
    this.started = false;      // the clock waits for the player's first move
    this.paused = false;
    this.elapsed = 0;
    this.penalty = 0;
    this.lostAt = -1;
    this.actions = 0;
    this.par = 0;
    this.fair = true;          // false only if the generator ran out of budget
    this.flagMode = false;
    this.events.length = 0;

    // A shared board needs a shared opening, so the Daily is dealt up front and
    // its first square is already turned over when the player arrives.
    if (cfg.opening != null) {
      this.deal(cfg.opening);
      this.state = "playing";
      const out = [];
      this.floodFrom(cfg.opening, out);
      this.events.push({ type: "dig", cells: out });
    }
    return this;
  },

  /* --------------------------------------------------------------- deal -- */

  deal(opening) {
    const rng = RNG.sub(this.seed, "board");
    let r = Generate.board(this.cols, this.rows, this.mines, opening, rng);
    // A second, far more patient attempt before we would ever hand over a board
    // that might need a guess. In practice the first call has never failed.
    if (!r) r = Generate.board(this.cols, this.rows, this.mines, opening, RNG.sub(this.seed, "board", "retry"), { maxTries: 4000 });
    if (!r) {
      this.fair = false;
      const spare = RNG.sub(this.seed, "board", "fallback");
      this.board = Board.make(this.cols, this.rows, Generate.scatter(this.cols, this.rows, this.mines, opening, spare));
      this.actions = this.n - this.mines;
    } else {
      this.board = r.board;
      this.actions = r.actions;
    }
    this.par = parFor(this.actions);
    return this.board;
  },

  /* -------------------------------------------------------------- state -- */

  minesLeft() { return this.mines - this.marked; },
  clock() { return this.elapsed + this.penalty; },
  running() { return this.state === "playing"; },

  tick(dt) {
    if (this.state !== "playing" || this.paused || !this.started) return;
    this.elapsed += dt;
  },

  cell(i) {
    return { rev: !!this.rev[i], mark: !!this.mk[i], num: this.board ? this.board.num[i] : 0 };
  },

  /* --------------------------------------------------------------- play -- */

  // What a plain tap does, honouring the mode toggle. Both paths end in the
  // same two calls so the toggle can never behave differently from a long press.
  tap(i) { return this.flagMode ? this.mark(i) : this.dig(i); },
  hold(i) { return this.flagMode ? this.dig(i) : this.mark(i); },

  dig(i) {
    if (i < 0 || i >= this.n) return false;
    if (this.state === "ready") {
      this.deal(i);
      this.state = "playing";
      this.started = true;
    }
    if (this.state !== "playing" || this.paused) return false;
    if (this.mk[i]) return false;            // a marker has to come off first
    if (this.rev[i]) return this.chord(i);

    this.started = true;
    if (this.board.mine[i]) return this.strike(i);

    const out = [];
    this.floodFrom(i, out);
    this.events.push({ type: "dig", cells: out });
    Sfx.dig(out.length);
    this.checkWin();
    return true;
  },

  mark(i) {
    if (this.state !== "playing" || this.paused) return false;
    if (i < 0 || i >= this.n || this.rev[i]) return false;
    this.started = true;
    if (this.mk[i]) { this.mk[i] = 0; this.marked--; Sfx.unmark(); }
    else { this.mk[i] = 1; this.marked++; Sfx.mark(); }
    this.events.push({ type: "mark", i, on: !!this.mk[i] });
    return true;
  },

  // Tapping a number you have fully marked clears everything else around it.
  // The speed of the whole game lives here, and so does most of its danger:
  // a chord off a wrong marker is how an expert dies.
  chord(i) {
    if (this.state !== "playing" || this.paused) return false;
    const b = this.board;
    if (!this.rev[i] || b.num[i] <= 0) return false;

    let marks = 0;
    const open = [];
    for (const j of b.nbr[i]) {
      if (this.mk[j]) marks++;
      else if (!this.rev[j]) open.push(j);
    }
    if (marks !== b.num[i] || !open.length) return false;

    for (const j of open) if (b.mine[j]) return this.strike(j);

    const out = [];
    for (const j of open) if (!this.rev[j]) this.floodFrom(j, out);
    this.events.push({ type: "dig", cells: out, chord: i });
    Sfx.dig(out.length);
    this.checkWin();
    return true;
  },

  // Gas. The bird goes first if there is one in the cage.
  strike(i) {
    if (this.canaries > 0) {
      this.canaries--;
      if (!this.mk[i]) { this.mk[i] = 1; this.marked++; }
      this.penalty += CANARY_PENALTY;
      this.events.push({ type: "canary", i, saved: true });
      Sfx.canaryDown();
      return true;
    }
    this.state = "lost";
    this.lostAt = i;
    this.events.push({ type: "boom", i });
    Sfx.boom();
    this.finish(false);
    return true;
  },

  // Send the bird ahead: it lands on a square the player could already have
  // proved safe from what is on screen, so it is a nudge and never a guess.
  sendCanary() {
    if (this.state !== "playing" || this.paused || this.canaries <= 0 || !this.board) return false;
    const i = Solver.provableSafe(this.board, { rev: this.rev, mk: this.mk });
    if (i < 0) return false;
    this.canaries--;
    this.started = true;
    const out = [];
    this.floodFrom(i, out);
    this.events.push({ type: "canary", i, saved: false, cells: out });
    Sfx.canarySent();
    this.checkWin();
    return true;
  },

  floodFrom(i, out) {
    const b = this.board, stack = [i];
    while (stack.length) {
      const k = stack.pop();
      if (this.rev[k]) continue;
      this.rev[k] = 1;
      // A flood only ever spills through squares with no gas beside them, so a
      // marker in its path was simply wrong — lift it rather than stopping.
      if (this.mk[k]) { this.mk[k] = 0; this.marked--; }
      this.revealed++;
      out.push(k);
      if (b.num[k] === 0) for (const j of b.nbr[k]) if (!this.rev[j]) stack.push(j);
    }
  },

  /* ----------------------------------------------------------- terminal -- */

  // Both the win and the loss are decided here, on the one path every driver
  // goes through — the UI and the headless bots alike.
  checkWin() {
    if (this.state !== "playing") return false;
    if (this.revealed < this.n - this.mines) return false;
    this.state = "won";
    for (let i = 0; i < this.n; i++) if (this.board.mine[i] && !this.mk[i]) { this.mk[i] = 1; this.marked++; }
    this.events.push({ type: "win" });
    Sfx.clear();
    this.finish(true);
    return true;
  },

  result(cleared) {
    const res = {
      mode: this.mode, shiftIdx: this.shiftIdx, sizeId: this.sizeId, date: this.date,
      cleared, time: Math.round(this.clock() * 10) / 10, par: this.par, actions: this.actions,
      canariesLeft: this.canaries, canariesStart: this.canariesStart,
      cols: this.cols, rows: this.rows, mines: this.mines, seed: this.seed,
      dug: this.revealed, penalty: this.penalty, fair: this.fair,
    };
    res.stars = starsFor(res);
    return res;
  },

  finish(cleared) {
    this.last = this.result(cleared);
    if (typeof App !== "undefined" && App.shiftOver) App.shiftOver(this.last);
    return this.last;
  },

  quit() {
    this.state = "quit";
    if (typeof App !== "undefined" && App.shiftOver) App.shiftOver(null);
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { Game, CANARY_PENALTY });