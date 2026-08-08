// Every board the game deals has to be fair: the opening safe, the mine count
// honest, and the whole thing finishable by logic alone. That is checked here
// over every shift in the campaign rather than trusted to the generator's own
// accept test, because the generator and the checker being the same code is
// exactly how a guarantee quietly stops holding.

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");

const { Board, Solver, Generate, SHIFTS, SIZES, DAILY, parFor, starsFor } = S;
const SEEDS = Number(process.env.CD_SEEDS || 8);

function check(label, spec, seeds, fails, stats) {
  for (let s = 0; s < seeds; s++) {
    S.__reseed(1200 + s * 31);
    const rng = S.RNG.make(S.RNG.seedFrom(`${label}|${s}`));
    const opening = Math.floor(S.__rand() * spec.cols * spec.rows);

    const t0 = process.hrtime.bigint();
    const g = Generate.board(spec.cols, spec.rows, spec.mines, opening, rng);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    if (!g) { fails.push(`${label} seed ${s}: no fair board found inside the budget`); continue; }

    let count = 0;
    for (let i = 0; i < g.board.n; i++) if (g.board.mine[i]) count++;
    if (count !== spec.mines) fails.push(`${label} seed ${s}: ${count} mines, expected ${spec.mines}`);

    for (const i of Board.openingArea(spec.cols, spec.rows, opening)) {
      if (g.board.mine[i]) { fails.push(`${label} seed ${s}: gas inside the opening at ${i}`); break; }
    }

    // The independent re-check: solve it again from scratch.
    const r = Solver.solve(g.board, opening);
    if (!r.won) fails.push(`${label} seed ${s}: dealt a board that needs a guess`);

    if (stats) {
      stats.ms += ms; stats.worst = Math.max(stats.worst, ms);
      stats.tries += g.tries; stats.actions += g.actions; stats.n++;
    }
  }
}

test("the shift table is dealable at all", () => {
  const fails = [];
  SHIFTS.forEach((s, i) => {
    if (!Generate.fits(s.cols, s.rows, s.mines)) fails.push(`shift ${i + 1} ${s.name}: too many mines for the board`);
    if (s.cols > 13) fails.push(`shift ${i + 1} ${s.name}: ${s.cols} columns is too wide for a phone`);
    if (s.canaries < 1) fails.push(`shift ${i + 1} ${s.name}: no bird in the cage`);
    if (!s.hint) fails.push(`shift ${i + 1} ${s.name}: no hint line`);
    if (!SEAMS_OK(s.seam)) fails.push(`shift ${i + 1} ${s.name}: seam ${s.seam} does not exist`);
  });
  function SEAMS_OK(i) { return i >= 0 && i < S.SEAMS.length; }
  assert.deepEqual(fails, []);
});

test("difficulty only ever goes up", () => {
  const fails = [];
  let last = 0;
  SHIFTS.forEach((s, i) => {
    const d = s.mines / (s.cols * s.rows);
    if (d < last - 0.001) fails.push(`shift ${i + 1} ${s.name}: ${(d * 100).toFixed(1)}% gas is thinner than the shift before it`);
    last = d;
  });
  const first = SHIFTS[0], deepest = SHIFTS[SHIFTS.length - 1];
  assert.ok(first.mines / (first.cols * first.rows) < 0.13, "the first shift should be gentle");
  assert.ok(deepest.mines / (deepest.cols * deepest.rows) > 0.24, "the last shift should be past Expert density");
  assert.ok(deepest.mines / (deepest.cols * deepest.rows) < 0.29,
    "past ~29% the generator runs out of fair boards, so the table must not go there");
  assert.deepEqual(fails, []);
});

test("every shift deals a fair board, on every seed", () => {
  const fails = [];
  const stats = { ms: 0, worst: 0, tries: 0, actions: 0, n: 0 };
  SHIFTS.forEach((s, i) => check(`shift ${i + 1} ${s.name}`, s, SEEDS, fails, stats));
  assert.deepEqual(fails, []);

  // Dealing happens on the player's first tap, so it has to be imperceptible.
  assert.ok(stats.worst < 400, `slowest deal was ${stats.worst.toFixed(0)}ms`);
  if (process.env.CD_REPORT) {
    console.log(`\ndeals: ${stats.n}  avg ${(stats.ms / stats.n).toFixed(1)}ms  worst ${stats.worst.toFixed(0)}ms  ` +
      `avg ${(stats.tries / stats.n).toFixed(1)} tries  avg ${(stats.actions / stats.n).toFixed(0)} decisions`);
  }
});

test("free-dig sizes and the Daily Seam deal fair boards too", () => {
  const fails = [];
  for (const z of SIZES) check(`size ${z.name}`, z, SEEDS, fails);
  check("daily", DAILY, SEEDS, fails);
  assert.deepEqual(fails, []);
});

test("the Daily Seam is the same board for everybody, and different every day", () => {
  const fingerprint = (date) => {
    const seed = S.RNG.seedFrom("canary-deep|" + date);
    const opening = S.RNG.sub(seed, "opening").int(0, DAILY.cols * DAILY.rows - 1);
    const g = Generate.board(DAILY.cols, DAILY.rows, DAILY.mines, opening, S.RNG.sub(seed, "board"));
    return { opening, mines: [...g.board.mine].join("") };
  };
  const a = fingerprint("2026-08-09");
  const b = fingerprint("2026-08-09");
  const c = fingerprint("2026-08-10");
  assert.deepEqual(a, b, "the same date must deal the same board on every device");
  assert.notDeepEqual(a.mines, c.mines, "a new day must be a new board");
});

test("par is worth chasing but not free", () => {
  // Par is 5s plus 0.8s per decision the solver had to make. Those two
  // constants are the whole difficulty of the second star, so state what they
  // mean as an assertion rather than leaving them as bare numbers.
  const fails = [];
  for (const actions of [20, 60, 120, 200, 300]) {
    const par = parFor(actions);
    if (par < actions * 0.8) fails.push(`${actions} decisions: par ${par}s is under a brisk 0.8s a tap`);
    if (par > actions * 1.2) fails.push(`${actions} decisions: par ${par}s is generous enough to be automatic`);
  }
  assert.deepEqual(fails, []);
});

test("stars mean what the results screen says they mean", () => {
  const base = { cleared: true, time: 50, par: 100, canariesLeft: 1, canariesStart: 1 };
  assert.equal(starsFor({ ...base, cleared: false }), 0);
  assert.equal(starsFor({ ...base, time: 150 }), 1, "over par is one star");
  assert.equal(starsFor({ ...base, canariesLeft: 0 }), 2, "under par but a bird spent is two");
  assert.equal(starsFor(base), 3, "under par with a full cage is three");
});