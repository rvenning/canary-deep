// Dealing a board that never needs a guess.
//
// The promise the whole game rests on is that you can always work it out. A
// random minesweeper board cannot promise that — sooner or later two cells are
// symmetric and you toss a coin — so the board the player gets is filtered:
// scatter the mines, hand the position to the solver, and keep it only if pure
// logic finishes it from the opening dig.
//
// Rejecting and rescattering works but is slow at the densities the deep shifts
// use. Repairing is far quicker: when the solver stalls it has told us exactly
// where the ambiguity is, so lift one mine out of the stuck frontier and drop
// it into the dark, where it constrains nothing yet. Most stalls clear in a
// handful of nudges. A full rescatter every so often stops a hopeless start
// from being nudged forever.
//
// Everything draws from a seeded generator passed in, so the same seed deals
// the same shift on every device — that is what makes the Daily Seam the same
// board for the whole family.

const Generate = {
  MAX_TRIES: 900,        // total solver runs before we give up on a seed
  REPAIRS_PER_SCATTER: 26,

  shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  },

  scatter(cols, rows, mines, opening, rng) {
    const banned = new Set(Board.openingArea(cols, rows, opening));
    const pool = [];
    for (let i = 0; i < cols * rows; i++) if (!banned.has(i)) pool.push(i);
    this.shuffle(pool, rng);
    return pool.slice(0, mines);
  },

  // A mine sitting in the stalled frontier is the ambiguity; a cell nowhere
  // near anything dug is the quietest place to put it.
  repair(board, st, mineSet, opening, rng) {
    const banned = new Set(Board.openingArea(board.cols, board.rows, opening));
    const frontierMines = [], dark = [], anyFree = [];

    for (let i = 0; i < board.n; i++) {
      if (st.rev[i]) continue;
      let touchesDug = false;
      for (const j of board.nbr[i]) if (st.rev[j]) { touchesDug = true; break; }
      if (board.mine[i]) { if (touchesDug) frontierMines.push(i); }
      else if (!banned.has(i)) { anyFree.push(i); if (!touchesDug) dark.push(i); }
    }
    if (!frontierMines.length || !anyFree.length) return null;

    const from = frontierMines[Math.floor(rng() * frontierMines.length)];
    const target = dark.length ? dark : anyFree;
    const to = target[Math.floor(rng() * target.length)];

    const next = new Set(mineSet);
    next.delete(from);
    next.add(to);
    return next;
  },

  // Deal one board. Returns { board, actions, tries } or null if this seed
  // could not produce a fair board inside the budget.
  board(cols, rows, mines, opening, rng, opts = {}) {
    const maxTries = opts.maxTries || this.MAX_TRIES;
    let tries = 0;
    let mineSet = new Set(this.scatter(cols, rows, mines, opening, rng));
    let sinceScatter = 0;

    while (tries < maxTries) {
      const board = Board.make(cols, rows, [...mineSet]);
      const res = Solver.solve(board, opening, opts);
      tries++;

      if (res.won) return { board, actions: res.actions, tries };

      const fixed = sinceScatter < this.REPAIRS_PER_SCATTER
        ? this.repair(board, res.state, mineSet, opening, rng)
        : null;
      if (fixed) { mineSet = fixed; sinceScatter++; }
      else { mineSet = new Set(this.scatter(cols, rows, mines, opening, rng)); sinceScatter = 0; }
    }
    return null;
  },

  // Enough cells to hold the mines with the opening's nine squares kept clear,
  // plus one cell to actually dig into. Guards the shift table against a typo
  // that would make a board impossible to deal.
  fits(cols, rows, mines) { return mines <= cols * rows - 10; },
};

if (typeof window === "undefined") Object.assign(globalThis, { Generate });
