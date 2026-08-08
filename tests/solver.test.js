// The solver is the game's promise. If it ever deduces something FALSE, the
// generator hands out a board that kills the player through no fault of their
// own — so soundness is checked far harder here than strength is.

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");

const { Board, Solver } = S;

// Build a board from a picture. '*' is gas, '.' is not.
function fromArt(rows) {
  const cols = rows[0].length;
  const mines = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "*") mines.push(r * cols + c); }));
  return Board.make(cols, rows.length, mines);
}

function randomBoard(cols, rows, mines, opening, rand) {
  const banned = new Set(Board.openingArea(cols, rows, opening));
  const pool = [];
  for (let i = 0; i < cols * rows; i++) if (!banned.has(i)) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Board.make(cols, rows, pool.slice(0, mines));
}

// Play a board with only SOME of the rules switched on, so each rule's own
// contribution can be measured.
function playWith(board, opening, allow) {
  const st = Solver.newState(board);
  if (Solver.reveal(board, st, opening) < 0) return { won: false, st };
  for (let round = 0; round < 4000; round++) {
    const cons = Solver.constraints(board, st);
    const safe = new Set(), mines = new Set();
    if (allow.count) Solver.ruleCount(cons, safe, mines);
    if (allow.subset && !safe.size && !mines.size) Solver.ruleSubset(cons, safe, mines);
    if (allow.total && !safe.size && !mines.size) Solver.ruleTotal(board, st, safe, mines);
    if (allow.enumerate && !safe.size && !mines.size) Solver.ruleEnumerate(board, st, cons, safe, mines);
    if (!safe.size && !mines.size) break;
    for (const i of mines) Solver.mark(board, st, i);
    for (const i of safe) if (!st.rev[i] && !st.mk[i] && Solver.reveal(board, st, i) < 0) return { won: false, st, unsound: i };
  }
  return { won: Solver.won(board, st), st };
}

test("neighbour counts are right, including at the corners", () => {
  const b = fromArt([
    "*..",
    "...",
    "..*",
  ]);
  assert.equal(b.num[0], -1);
  assert.equal(b.num[1], 1);          // touches the top-left mine
  assert.equal(b.num[4], 2);          // centre touches both
  assert.equal(b.num[2], 0);          // top-right touches neither
  assert.equal(b.mines, 2);
});

test("a flood opens the whole zero region and its number border", () => {
  const b = fromArt([
    ".....",
    ".....",
    ".....",
    "....*",
  ]);
  const st = Solver.newState(b);
  const n = Solver.reveal(b, st, 0);
  assert.equal(n, b.n - 1, "everything but the gas should open from one corner");
});

test("counting finds the obvious, and knows when it cannot", () => {
  const full = [{ cells: [10, 11], need: 2 }];
  const s1 = new Set(), m1 = new Set();
  Solver.ruleCount(full, s1, m1);
  assert.deepEqual([...m1].sort(), [10, 11]);

  const empty = [{ cells: [10, 11], need: 0 }];
  const s2 = new Set(), m2 = new Set();
  Solver.ruleCount(empty, s2, m2);
  assert.deepEqual([...s2].sort(), [10, 11]);

  const ambiguous = [{ cells: [10, 11], need: 1 }];
  const s3 = new Set(), m3 = new Set();
  Solver.ruleCount(ambiguous, s3, m3);
  assert.equal(s3.size + m3.size, 0);
});

test("the subset rule reads 1-2 and 1-1, which counting cannot", () => {
  // 1-2: one number sees {10,11} and wants 1, its neighbour sees {10,11,12}
  // and wants 2. The extra square must hold the extra mine.
  const twelve = [{ cells: [10, 11], need: 1 }, { cells: [10, 11, 12], need: 2 }];
  const sc = new Set(), mc = new Set();
  Solver.ruleCount(twelve, sc, mc);
  assert.equal(sc.size + mc.size, 0, "counting alone must be stuck here, or this test proves nothing");
  const s1 = new Set(), m1 = new Set();
  Solver.ruleSubset(twelve, s1, m1);
  assert.deepEqual([...m1], [12]);
  assert.equal(s1.size, 0);

  // 1-1: both want one mine, so the extra square cannot hold one.
  const eleven = [{ cells: [10, 11], need: 1 }, { cells: [10, 11, 12], need: 1 }];
  const s2 = new Set(), m2 = new Set();
  Solver.ruleSubset(eleven, s2, m2);
  assert.deepEqual([...s2], [12]);
  assert.equal(m2.size, 0);
});

test("the mines-remaining counter clears the dark, and fills it", () => {
  const b = fromArt([
    "*.....",
    "......",
    "......",
  ]);
  const st = Solver.newState(b);
  Solver.mark(b, st, 0);                       // the one mine is accounted for
  const safe = new Set(), mines = new Set();
  Solver.ruleTotal(b, st, safe, mines);
  assert.equal(safe.size, b.n - 1, "with nothing left to find, everything dark is clean");
  assert.equal(mines.size, 0);

  const b2 = fromArt(["**", "**"]);
  const st2 = Solver.newState(b2);
  const s2 = new Set(), m2 = new Set();
  Solver.ruleTotal(b2, st2, s2, m2);
  assert.equal(m2.size, 4, "as many mines left as squares means they are all gas");
});

test("each rule earns its place: strength strictly increases as they are added", () => {
  // Not a strength target — a liveness check. If a rule ever stops adding
  // boards it is dead code, and the generator has quietly got slower for
  // nothing.
  const tally = { count: 0, subset: 0, total: 0, all: 0 };
  for (let t = 0; t < 120; t++) {
    S.__reseed(5100 + t);
    const opening = Math.floor(S.__rand() * 9 * 12);
    const b = randomBoard(9, 12, 18, opening, S.__rand);
    if (playWith(b, opening, { count: 1 }).won) tally.count++;
    if (playWith(b, opening, { count: 1, subset: 1 }).won) tally.subset++;
    if (playWith(b, opening, { count: 1, subset: 1, total: 1 }).won) tally.total++;
    if (playWith(b, opening, { count: 1, subset: 1, total: 1, enumerate: 1 }).won) tally.all++;
  }
  assert.ok(tally.subset > tally.count, `subsets added nothing: ${JSON.stringify(tally)}`);
  assert.ok(tally.total >= tally.subset, JSON.stringify(tally));
  assert.ok(tally.all > tally.total, `enumeration added nothing: ${JSON.stringify(tally)}`);
});

test("SOUNDNESS: over 400 random boards the solver never deduces a falsehood", () => {
  const fails = [];
  const sizes = [[8, 8, 10], [9, 12, 19], [11, 16, 36], [13, 22, 74]];

  for (let t = 0; t < 400; t++) {
    const [cols, rows, mines] = sizes[t % sizes.length];
    S.__reseed(9000 + t);
    const opening = Math.floor(S.__rand() * cols * rows);
    const b = randomBoard(cols, rows, mines, opening, S.__rand);
    const r = Solver.solve(b, opening, {});

    if (r.unsound != null) { fails.push(`board ${t}: dug gas at ${r.unsound}`); continue; }
    for (let i = 0; i < b.n; i++) {
      if (r.state.mk[i] && !b.mine[i]) { fails.push(`board ${t}: marked clean square ${i} as gas`); break; }
      if (r.state.rev[i] && b.mine[i]) { fails.push(`board ${t}: opened gas at ${i}`); break; }
    }
  }
  assert.deepEqual(fails, []);
});

test("a board the generator accepts really does open completely", () => {
  const fails = [];
  for (let t = 0; t < 60; t++) {
    S.__reseed(4400 + t);
    const opening = Math.floor(S.__rand() * 9 * 12);
    const g = S.Generate.board(9, 12, 18, opening, S.RNG.make(700 + t));
    if (!g) { fails.push(`seed ${t}: no board dealt`); continue; }
    const r = Solver.solve(g.board, opening);
    if (!r.won) { fails.push(`seed ${t}: generator returned an unsolvable board`); continue; }
    let open = 0;
    for (let i = 0; i < g.board.n; i++) if (r.state.rev[i]) open++;
    if (open !== g.board.n - g.board.mines) fails.push(`seed ${t}: won with ${open} of ${g.board.n - g.board.mines} squares open`);
  }
  assert.deepEqual(fails, []);
});

test("provableSafe never sends the bird onto gas, even off wrong markers", () => {
  const fails = [];
  for (let t = 0; t < 80; t++) {
    S.__reseed(2200 + t);
    const opening = Math.floor(S.__rand() * 10 * 14);
    const g = S.Generate.board(10, 14, 27, opening, S.RNG.make(300 + t));
    const st = Solver.newState(g.board);
    Solver.reveal(g.board, st, opening);

    // Poison the view with markers a careless player might have planted.
    for (let k = 0; k < 4; k++) {
      const i = Math.floor(S.__rand() * g.board.n);
      if (!st.rev[i]) st.mk[i] = 1;
    }
    const i = Solver.provableSafe(g.board, st);
    if (i < 0) continue;                       // nothing left is a legitimate answer
    if (g.board.mine[i]) fails.push(`seed ${t}: canary sent onto gas at ${i}`);
    else if (st.rev[i]) fails.push(`seed ${t}: canary sent to an already-open square ${i}`);
  }
  assert.deepEqual(fails, []);
});