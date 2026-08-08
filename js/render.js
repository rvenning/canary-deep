// Canvas, input and the frame loop. The engine never calls into here and this
// file never decides anything about the game — it draws whatever Game is
// holding and turns pointers into Game calls.
//
// The input model is the part worth reading. A 13-wide board on a phone gives
// roughly 26px squares, which is below anything you would call a comfortable
// tap target, and minesweeper punishes a mis-tap harder than almost any other
// game. So a tap is not committed on press: pressing lights the square up,
// sliding moves the lit square, and only lifting your finger acts. You can see
// where you are about to dig before you dig it, which makes a small grid
// genuinely playable instead of merely legible.

const NUM_COLOURS = [
  "", "#6fb2ff", "#7bd88a", "#ff8a7a", "#c6a2ff",
  "#ffc14d", "#56d6d0", "#f2f5f8", "#a3b1c0",
];

const HOLD_MS = 380;      // press-and-hold before the alternate action fires
const SLOP = 26;          // px of finger travel still counted as the same gesture
// Fitting the board to the stage is right on a phone and silly on a monitor,
// where a 7-wide shift would give 60px squares. Past this the board stops
// growing and the rock around it does the filling instead.
const MAX_CELL = 46;

const Render = {
  W: 360, H: 520, scale: 1,
  cell: 26, ox: 0, oy: 0,
  press: -1,            // the square currently lit under the finger
  held: false,          // the hold action already fired for this gesture
  revealAll: false,     // set when a shift ends, so the gas shows

  boot() {
    this.cv = document.getElementById("cv");
    this.ctx = this.cv.getContext("2d");
    this.stage = document.getElementById("game-stage");
    this.bindInput();

    // iOS settles its viewport lazily, and the stage can change size with no
    // resize event at all (a HUD row rewrapping, a web font landing), so the
    // loop watches for drift as well.
    addEventListener("resize", () => this.resize());
    addEventListener("orientationchange", () => setTimeout(() => this.resize(), 350));
    if (window.visualViewport) visualViewport.addEventListener("resize", () => this.resize());
  },

  resize() {
    if (!this.stage) return;
    const box = this.stage.getBoundingClientRect();
    if (box.width < 50 || box.height < 50) return;   // hidden screen: keep the last good layout
    this.W = box.width; this.H = box.height;

    // Display size comes from the stylesheet (width/height 100%); only the
    // backing store is sized here, or the canvas renders at its attribute size
    // and overflows every retina screen by the device pixel ratio.
    const dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.round(this.W * dpr);
    this.cv.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
  },

  layout() {
    const cols = Game.cols || 10, rows = Game.rows || 14;
    const pad = 10;
    this.cell = Math.max(8, Math.min(MAX_CELL,
      Math.floor(Math.min((this.W - pad * 2) / cols, (this.H - pad * 2) / rows))));
    this.bw = this.cell * cols;
    this.bh = this.cell * rows;
    this.ox = Math.round((this.W - this.bw) / 2);
    this.oy = Math.round((this.H - this.bh) / 2);
  },

  cellAt(x, y) {
    const c = Math.floor((x - this.ox) / this.cell);
    const r = Math.floor((y - this.oy) / this.cell);
    if (c < 0 || r < 0 || c >= Game.cols || r >= Game.rows) return -1;
    return r * Game.cols + c;
  },

  cellXY(i) {
    return { x: this.ox + (i % Game.cols) * this.cell, y: this.oy + Math.floor(i / Game.cols) * this.cell };
  },

  /* -------------------------------------------------------------- input -- */

  bindInput() {
    const local = (e) => {
      const r = this.cv.getBoundingClientRect();
      return this.cellAt(e.clientX - r.left, e.clientY - r.top);
    };

    this.cv.addEventListener("pointerdown", (e) => {
      if (!Game.running() && Game.state !== "ready") return;
      e.preventDefault();
      this.startX = e.clientX; this.startY = e.clientY;
      this.press = local(e);
      this.held = false;
      clearTimeout(this.holdTimer);
      // Capture keeps a slide that strays over the action bar attached to the
      // canvas — but it THROWS NotFoundError if the browser does not consider
      // this pointer active, and an unguarded throw here takes the rest of the
      // gesture setup with it. Set the state first, then try to capture.
      try { this.cv.setPointerCapture?.(e.pointerId); } catch { /* not capturable; the gesture still works */ }
      if (this.press >= 0) {
        this.holdTimer = setTimeout(() => {
          if (this.press < 0) return;
          this.held = true;
          Game.hold(this.press);
          this.press = -1;
        }, HOLD_MS);
      }
    }, { passive: false });

    // Sliding to the square next door is a correction, not a new gesture — but
    // moving at all means the finger is no longer still, so the hold is off.
    const move = (x, y) => {
      if (this.press < 0 && !this.held) return;
      const r = this.cv.getBoundingClientRect();
      const next = this.cellAt(x - r.left, y - r.top);
      if (this.held) return;
      if (Math.abs(x - this.startX) > 3 || Math.abs(y - this.startY) > 3) clearTimeout(this.holdTimer);
      this.press = next;
    };
    this.cv.addEventListener("pointermove", (e) => {
      // PointerEvent.pressure is 0 for ordinary touch on iOS, so asking about
      // the button state here would drop every move of a real drag.
      if (e.pointerType === "touch" || e.pointerType === "mouse" || e.buttons) { e.preventDefault(); move(e.clientX, e.clientY); }
    }, { passive: false });
    this.cv.addEventListener("touchmove", (e) => {
      e.preventDefault();
      if (e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    const end = (e) => {
      clearTimeout(this.holdTimer);
      const i = this.press;
      this.press = -1;
      if (this.held) { this.held = false; return; }
      if (i < 0) return;
      const far = Math.abs(e.clientX - this.startX) > this.cell * 3 + SLOP
        || Math.abs(e.clientY - this.startY) > this.cell * 3 + SLOP;
      if (far) return;              // a long drag across the board is a cancel
      Game.tap(i);
    };
    this.cv.addEventListener("pointerup", end);
    this.cv.addEventListener("pointercancel", () => { clearTimeout(this.holdTimer); this.press = -1; this.held = false; });

    // A mouse still wants its right button to plant a marker.
    this.cv.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const i = local(e);
      if (i >= 0) { clearTimeout(this.holdTimer); this.press = -1; Game.hold(i); }
    });
  },

  /* -------------------------------------------------------------- frame -- */

  drainEvents() {
    for (const ev of Game.events) {
      const at = (i) => {
        const p = this.cellXY(i);
        return [p.x + this.cell / 2, p.y + this.cell / 2];
      };
      if (ev.type === "dig" && ev.cells.length > 3) {
        for (const c of ev.cells.slice(0, 26)) Fx.dust(...at(c), 2, "#6b7787");
      } else if (ev.type === "mark") {
        if (ev.on) Fx.burst(...at(ev.i), "#ffc23d", 5, 90, 0.3, 2);
      } else if (ev.type === "canary") {
        Fx.burst(...at(ev.i), ev.saved ? "#ffd45e" : "#ffe9a8", 16, 140, 0.6, 3);
        Fx.text(...at(ev.i), ev.saved ? `-${CANARY_PENALTY}s` : "safe!", { color: ev.saved ? "#ff9f6b" : "#ffe9a8", size: 15 });
        if (ev.saved) Fx.addShake(5);
      } else if (ev.type === "boom") {
        this.revealAll = true;
        Fx.burst(...at(ev.i), "#ff7043", 34, 220, 0.8, 4);
        Fx.addShake(13);
        Fx.addFlash(0.5, "#ff5722");
      } else if (ev.type === "win") {
        this.revealAll = true;
        Fx.confetti(this.W, this.H, ["#ffc23d", "#7bd88a", "#6fb2ff", "#ffe9a8"], 70);
      }
    }
    Game.events.length = 0;
  },

  update(dt) {
    // The stage can resize with no event of its own; noticing the drift here is
    // cheaper than chasing every cause.
    const b = this.stage.getBoundingClientRect();
    if (b.width > 50 && b.height > 50 && (Math.abs(b.width - this.W) > 1 || Math.abs(b.height - this.H) > 1)) this.resize();

    Game.tick(dt);
    this.drainEvents();
    Fx.update(dt);
    this.hud();
  },

  hud() {
    const t = Game.clock();
    const el = (id) => document.getElementById(id);
    el("hud-mines").textContent = `💣 ${Game.minesLeft()}`;
    el("hud-time").textContent = this.time(t);
    el("hud-canary").textContent = `🐤 ${Game.canaries}`;
    const send = el("btn-canary");
    if (send) send.disabled = Game.canaries <= 0 || !Game.board || !Game.running();
    const flag = el("btn-flagmode");
    if (flag) {
      flag.textContent = Game.flagMode ? "🚩 Mark" : "⛏️ Dig";
      flag.classList.toggle("on", Game.flagMode);
    }
  },

  time(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
  },

  ord(n) { return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`; },

  /* --------------------------------------------------------------- draw -- */

  rrect(x, y, w, h, r) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  },

  draw() {
    const c = this.ctx;
    if (!c || this.W < 2) return;
    c.save();
    c.clearRect(0, 0, this.W, this.H);

    // Rock: a lamp glow above the board fading into the dark below it.
    const g = c.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, "#1d2732");
    g.addColorStop(0.55, "#141c25");
    g.addColorStop(1, "#0d131a");
    c.fillStyle = g;
    c.fillRect(0, 0, this.W, this.H);

    if (!Game.cols) { c.restore(); return; }

    // The gas is shown once the shift is over. Derived from the engine's own
    // state rather than only from the event that ended it, so a frame missed
    // while the tab was hidden cannot leave the last board half-told.
    this.revealAll = this.revealAll || Game.state === "lost" || Game.state === "won";

    const [shx, shy] = Fx.shakeOffset();
    c.translate(shx, shy);

    // A cut timber rim so the board reads as a working face rather than a grid
    // floating in a void.
    c.fillStyle = "#2a3441";
    this.rrect(this.ox - 7, this.oy - 7, this.bw + 14, this.bh + 14, 9);
    c.fill();
    c.fillStyle = "#111820";
    this.rrect(this.ox - 3, this.oy - 3, this.bw + 6, this.bh + 6, 6);
    c.fill();

    const s = this.cell;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = `700 ${Math.round(s * 0.6)}px 'Baloo 2', system-ui, sans-serif`;

    for (let i = 0; i < Game.n; i++) {
      const p = this.cellXY(i);
      this.drawCell(i, p.x, p.y, s);
    }
    Fx.render(c);
    c.restore();
  },

  drawCell(i, x, y, s) {
    const c = this.ctx;
    const b = Game.board;
    const isMine = b && b.mine[i];
    const shown = Game.rev[i];
    const marked = Game.mk[i];
    const lit = this.press === i;

    if (shown) {
      c.fillStyle = "#161d25";
      this.rrect(x + 1, y + 1, s - 2, s - 2, 3);
      c.fill();
      const n = b.num[i];
      if (n > 0) {
        c.fillStyle = NUM_COLOURS[n];
        c.fillText(String(n), x + s / 2, y + s / 2 + s * 0.03);
      }
      return;
    }

    if (this.revealAll && isMine && !marked) { this.drawGas(x, y, s, i === Game.lostAt); return; }
    if (this.revealAll && marked && !isMine) { this.drawWrong(x, y, s); return; }

    // Covered rock: a lit top edge and a dark under-edge so the squares read as
    // solid, and a faint per-square tint so a big field is not a flat slab.
    const tint = Math.floor(GK.util.hash2(i % Game.cols, Math.floor(i / Game.cols)) * 997) % 3;
    c.fillStyle = lit ? "#5d6c7e" : ["#3b4653", "#3e4956", "#394451"][tint];
    this.rrect(x + 1, y + 1, s - 2, s - 2, 4);
    c.fill();
    c.fillStyle = lit ? "rgba(255,255,255,.30)" : "rgba(255,255,255,.11)";
    this.rrect(x + 1, y + 1, s - 2, Math.max(2, s * 0.16), 4);
    c.fill();
    c.fillStyle = "rgba(0,0,0,.28)";
    this.rrect(x + 1, y + s - Math.max(3, s * 0.16) - 1, s - 2, Math.max(2, s * 0.14), 4);
    c.fill();

    if (marked) this.drawMarker(x, y, s, this.revealAll && isMine);
  },

  drawMarker(x, y, s, confirmed) {
    const c = this.ctx;
    const px = x + s * 0.36, py = y + s * 0.2;
    c.fillStyle = "#20272f";
    c.fillRect(px, py, Math.max(1.5, s * 0.075), s * 0.6);
    c.fillStyle = confirmed ? "#7bd88a" : "#ffc23d";
    c.beginPath();
    c.moveTo(px + s * 0.075, py);
    c.lineTo(px + s * 0.46, py + s * 0.14);
    c.lineTo(px + s * 0.075, py + s * 0.28);
    c.closePath();
    c.fill();
  },

  drawGas(x, y, s, fatal) {
    const c = this.ctx;
    c.fillStyle = fatal ? "#8c2f22" : "#232c36";
    this.rrect(x + 1, y + 1, s - 2, s - 2, 4);
    c.fill();
    const cx = x + s / 2, cy = y + s / 2, r = s * 0.2;
    c.fillStyle = fatal ? "#ffd9c9" : "#ff7043";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = c.fillStyle;
    c.lineWidth = Math.max(1, s * 0.06);
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(t) * r * 1.15, cy + Math.sin(t) * r * 1.15);
      c.lineTo(cx + Math.cos(t) * r * 1.75, cy + Math.sin(t) * r * 1.75);
      c.stroke();
    }
  },

  drawWrong(x, y, s) {
    const c = this.ctx;
    c.fillStyle = "#2b2530";
    this.rrect(x + 1, y + 1, s - 2, s - 2, 4);
    c.fill();
    this.drawMarker(x, y, s, false);
    c.strokeStyle = "#ff6b6b";
    c.lineWidth = Math.max(1.5, s * 0.09);
    c.beginPath();
    c.moveTo(x + s * 0.2, y + s * 0.2);
    c.lineTo(x + s * 0.8, y + s * 0.8);
    c.moveTo(x + s * 0.8, y + s * 0.2);
    c.lineTo(x + s * 0.2, y + s * 0.8);
    c.stroke();
  },
};

// The frame loop. Kept separate so the screen-change hook can stop it dead
// whenever the game screen is not the one on show.
const Engine = {
  raf: 0,
  last: 0,

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const step = (t) => {
      this.raf = requestAnimationFrame(step);
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      GK.Debug.frame(dt);
      Render.update(dt);
      Render.draw();
    };
    this.raf = requestAnimationFrame(step);
  },

  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; },
};