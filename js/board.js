// The board itself: dimensions, where the coal seams hide firedamp, and the
// number painted on every safe cell. Pure data — no DOM, no rendering, no
// randomness — so the solver, the generator and the test bots all drive the
// same object the game does.
//
// A cell is an index `r * cols + c` throughout. Everything that walks the grid
// goes through the precomputed neighbour table, which is cached per size:
// generating a board rebuilds it hundreds of times and the table never changes.

const NBR_CACHE = new Map();

function neighbourTable(cols, rows) {
  const key = cols + "x" + rows;
  const hit = NBR_CACHE.get(key);
  if (hit) return hit;

  const t = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const out = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          out.push(rr * cols + cc);
        }
      }
      t[r * cols + c] = out;
    }
  }
  NBR_CACHE.set(key, t);
  return t;
}

const Board = {
  neighbourTable,

  // `mineList` is a list of cell indices. num[i] is -1 on a mine, otherwise how
  // many of the eight neighbours hold one.
  make(cols, rows, mineList) {
    const n = cols * rows;
    const mine = new Uint8Array(n);
    for (const i of mineList) mine[i] = 1;

    const nbr = neighbourTable(cols, rows);
    const num = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      if (mine[i]) { num[i] = -1; continue; }
      let k = 0;
      for (const j of nbr[i]) if (mine[j]) k++;
      num[i] = k;
    }
    return { cols, rows, n, mines: mineList.length, mine, num, nbr };
  },

  rc(board, i) { return { c: i % board.cols, r: (i / board.cols) | 0 }; },
  idx(board, c, r) { return r * board.cols + c; },
  inside(board, c, r) { return c >= 0 && r >= 0 && c < board.cols && r < board.rows; },

  // The cells a first dig must not put a mine in: the clicked cell and its
  // eight neighbours, so the opening is always a 0 and always floods open.
  openingArea(cols, rows, i) {
    const nbr = neighbourTable(cols, rows);
    return [i, ...nbr[i]];
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { Board, neighbourTable });
