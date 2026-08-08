// Balance. Three bots play the real engine headlessly: one that reasons
// perfectly, one that reasons perfectly and then mis-taps like a person on a
// phone, and one that does not reason at all.
//
// A no-guess game moves where the difficulty lives. Nothing here is ever
// unwinnable, so a shift cannot be too hard in the usual sense — what makes the
// deep seams hard is that they take three hundred taps and every one of them is
// a chance to hit the wrong square. That means the honest measurements are
// "how many taps" and "how often does a slip cost the shift", not "can it be
// done".
//
// The clock is modelled rather than taken from the engine, because a bot plays
// instantly and par is a human target. A bot's taps are countable and par is
// defined per decision, so a pace in seconds-per-tap is all the model needs.

const test = require("node:test");
const assert = require("node:assert");
const S = require("./load.js");

const { Solver, Generate, Game, SHIFTS, SIZES, parFor } = S;
const SEEDS = Number(process.env.CD_SEEDS || 6);
// `node --test` runs each file in a child process, so a --report flag on the
// command line never reaches here — an environment variable does.
//   CD_REPORT=1 node --test tests/bot.test.js
const REPORT = !!process.env.CD_REPORT;

/* ------------------------------------------------------------- reasoning -- */

// Everything the player could work out from what is on screen right now. This
// reads the bot's OWN markers, wrong ones included — which is exactly how a
// slip turns into a death two minutes later.
function deduce(G) {
  const st = { rev: G.rev, mk: G.mk, revealed: G.revealed, marked: G.marked };
  const cons = Solver.constraints(G.board, st);
  const safe = new Set(), mines = new Set();
  Solver.ruleCount(cons, safe, mines);
  if (!safe.size && !mines.size) Solver.ruleSubset(cons, safe, mines);
  if (!safe.size && !mines.size) Solver.ruleTotal(G.board, st, safe, mines);
  if (!safe.size && !mines.size) Solver.ruleEnumerate(G.board, st, cons, safe, mines);
  return { safe, mines };
}

function unknowns(G) {
  const out = [];
  for (let i = 0; i < G.n; i++) if (!G.rev[i] && !G.mk[i]) out.push(i);
  return out;
}

/* ----------------------------------------------------------------- bots -- */

// A thumb on a 26px square. The slip lands on a neighbour of the square the
// player meant, which is the mistake this game actually punishes — and because
// press-slide-lift means you see the square before committing, the rate is low.
function slipTo(G, i, rate) {
  if (S.__rand() >= rate) return i;
  const n = G.board.nbr[i];
  return n[Math.floor(S.__rand() * n.length)];
}

function makeBrain(kind, opts = {}) {
  const slip = opts.slip || 0;
  return {
    kind,
    taps: 0,
    dig(G, i) { this.taps++; G.dig(slip ? slipTo(G, i, slip) : i); },
    mark(G, i) { this.taps++; G.mark(slip ? slipTo(G, i, slip) : i); },
    guess: !!opts.guess,
  };
}

function play(cfg, brain) {
  Game.start(cfg);
  brain.taps = 0;
  if (Game.state === "ready") {
    brain.taps++;
    Game.dig(Math.floor(S.__rand() * cfg.cols * cfg.rows));
  }
  for (let guard = 0; Game.running() && guard < 30000; guard++) {
    const { safe, mines } = deduce(Game);
    if (!safe.size && !mines.size) {
      const left = unknowns(Game);
      if (!left.length || !brain.guess) break;
      brain.taps++;
      Game.dig(left[Math.floor(S.__rand() * left.length)]);
      continue;
    }
    for (const i of mines) { if (!Game.running()) break; if (!Game.mk[i]) brain.mark(Game, i); }
    for (const i of safe) { if (!Game.running()) break; if (!Game.rev[i] && !Game.mk[i]) brain.dig(Game, i); }
  }
  const res = Game.last || Game.result(false);
  return { ...res, taps: brain.taps };
}

// What the clock would have said for a player working at this pace.
function timeAt(res, pace) { return res.taps * pace + res.penalty; }

function shiftCfg(i) {
  const s = SHIFTS[i];
  return { mode: "shift", shiftIdx: i, cols: s.cols, rows: s.rows, mines: s.mines, canaries: s.canaries };
}

// Same seed means the same board AND the same mistakes, whoever asks first —
// without this, a table measures the order the runs happened in.
function sweep(cfgFor, brainFor, seeds) {
  const out = [];
  for (let s = 0; s < seeds; s++) {
    S.__reseed(7700 + s * 977);
    out.push(play(cfgFor(), brainFor()));
  }
  return out;
}

const rate = (runs) => runs.filter((r) => r.cleared).length / runs.length;
const mean = (runs, f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;

/* ---------------------------------------------------------------- tests -- */

test("GUARDRAIL: a player who never slips clears every shift, first time, cage full", () => {
  const fails = [];
  const rows = [];
  for (let i = 0; i < SHIFTS.length; i++) {
    const runs = sweep(() => shiftCfg(i), () => makeBrain("perfect"), SEEDS);
    for (const [k, r] of runs.entries()) {
      if (!r.cleared) fails.push(`shift ${i + 1} ${SHIFTS[i].name}, seed ${k}: not cleared by perfect reasoning`);
      if (r.canariesLeft < r.canariesStart) fails.push(`shift ${i + 1}, seed ${k}: spent a bird without slipping`);
    }
    rows.push({ i, runs });
  }
  assert.deepEqual(fails, []);

  if (REPORT) {
    console.log("\n  shift                    size    gas    taps   par   @0.7s  @1.0s  @1.3s");
    for (const { i, runs } of rows) {
      const s = SHIFTS[i];
      const taps = mean(runs, (r) => r.taps), par = mean(runs, (r) => r.par);
      const at = (p) => `${(taps * p).toFixed(0).padStart(4)}s`;
      console.log(`  ${String(i + 1).padStart(2)}. ${s.name.padEnd(18)} ${`${s.cols}x${s.rows}`.padStart(6)} ` +
        `${((s.mines / (s.cols * s.rows)) * 100).toFixed(0).padStart(4)}% ${taps.toFixed(0).padStart(6)} ` +
        `${par.toFixed(0).padStart(5)}s ${at(0.7)}  ${at(1.0)}  ${at(1.3)}`);
    }
  }
});

test("par brackets a real pace: brisk beats it everywhere, dawdling beats it nowhere", () => {
  const brisk = [], slow = [];
  for (let i = 0; i < SHIFTS.length; i++) {
    const runs = sweep(() => shiftCfg(i), () => makeBrain("perfect"), 3);
    for (const r of runs) {
      brisk.push(timeAt(r, 0.7) <= r.par);
      slow.push(timeAt(r, 1.3) <= r.par);
    }
  }
  assert.ok(brisk.every(Boolean), "0.7s a tap should beat par on every shift, or the second star is out of reach");
  assert.ok(!slow.some(Boolean), "1.3s a tap should never beat par, or the second star is automatic");
});

test("CONTROL: digging at random clears nothing worth having", () => {
  const runs = [];
  for (let i = 0; i < SHIFTS.length; i++) {
    S.__reseed(3300 + i);
    Game.start(shiftCfg(i));
    Game.dig(Math.floor(S.__rand() * SHIFTS[i].cols * SHIFTS[i].rows));
    for (let g = 0; Game.running() && g < 5000; g++) {
      const left = unknowns(Game);
      if (!left.length) break;
      Game.dig(left[Math.floor(S.__rand() * left.length)]);
    }
    runs.push(Game.last || Game.result(false));
  }
  assert.equal(rate(runs), 0, "random digging must never clear a shift");
});

test("the campaign gets harder in the way a no-guess game can: more taps to slip on", () => {
  const early = sweep(() => shiftCfg(1), () => makeBrain("ordinary", { slip: 0.012, guess: true }), SEEDS);
  const deep = sweep(() => shiftCfg(SHIFTS.length - 1), () => makeBrain("ordinary", { slip: 0.012, guess: true }), SEEDS);
  assert.ok(mean(deep, (r) => r.taps) > mean(early, (r) => r.taps) * 2.5,
    "the last shift should be several times the work of an early one");
  assert.ok(rate(deep) <= rate(early), "and correspondingly less certain to survive");
});

test("KINDNESS: an ordinary player who mis-taps still gets through every shift", () => {
  // The one rule that outranks difficulty: losing is fine, being stuck is not.
  // Nothing here may be a wall, so every shift has to fall to an ordinary
  // player within a few goes. Three attempts is what "have another go" means.
  const fails = [];
  const table = [];
  for (let i = 0; i < SHIFTS.length; i++) {
    const runs = sweep(() => shiftCfg(i), () => makeBrain("ordinary", { slip: 0.012, guess: true }), SEEDS);
    const r = rate(runs);
    // 1 - (1-r)^3 is the chance of clearing it inside three attempts.
    const inThree = 1 - Math.pow(1 - r, 3);
    if (inThree < 0.9) fails.push(`shift ${i + 1} ${SHIFTS[i].name}: only ${(inThree * 100).toFixed(0)}% likely inside three goes`);
    table.push({ i, r, runs });
  }
  assert.deepEqual(fails, []);

  if (REPORT) {
    console.log("\n  ordinary player (1.2% mis-tap rate)");
    for (const { i, r, runs } of table) {
      console.log(`  ${String(i + 1).padStart(2)}. ${SHIFTS[i].name.padEnd(18)} cleared ${(r * 100).toFixed(0).padStart(3)}%  ` +
        `birds spent ${mean(runs, (x) => x.canariesStart - x.canariesLeft).toFixed(2)}`);
    }
  }
});

test("the bird in the cage earns its place", () => {
  // Take the deepest shifts, where the tap count makes a slip likely, and run
  // them with and without a bird. If the difference is nothing, the mechanic is
  // decoration.
  const withBird = [], without = [];
  for (let i = SHIFTS.length - 4; i < SHIFTS.length; i++) {
    withBird.push(...sweep(() => shiftCfg(i), () => makeBrain("ordinary", { slip: 0.02, guess: true }), SEEDS));
    without.push(...sweep(() => ({ ...shiftCfg(i), canaries: 0 }), () => makeBrain("ordinary", { slip: 0.02, guess: true }), SEEDS));
  }
  const a = rate(withBird), b = rate(without);
  assert.ok(a > b + 0.1, `a bird should be worth something: ${(a * 100).toFixed(0)}% with, ${(b * 100).toFixed(0)}% without`);
  if (REPORT) console.log(`\n  deepest four shifts, careless player: ${(a * 100).toFixed(0)}% with a bird, ${(b * 100).toFixed(0)}% without`);
});

test("sending the bird ahead is always safe and always makes progress", () => {
  const fails = [];
  for (let i = 0; i < SHIFTS.length; i += 4) {
    S.__reseed(6100 + i);
    Game.start(shiftCfg(i));
    Game.dig(Math.floor(S.__rand() * SHIFTS[i].cols * SHIFTS[i].rows));
    const before = Game.revealed;
    const ok = Game.sendCanary();
    if (!ok) { fails.push(`shift ${i + 1}: the bird refused to fly`); continue; }
    if (Game.state === "lost") fails.push(`shift ${i + 1}: the bird landed on gas`);
    if (Game.revealed <= before) fails.push(`shift ${i + 1}: the bird opened nothing`);
    if (Game.canaries !== SHIFTS[i].canaries - 1) fails.push(`shift ${i + 1}: the cage did not empty by one`);
  }
  assert.deepEqual(fails, []);
});

test("a bird in the cage takes the hit instead of ending the shift", () => {
  S.__reseed(88);
  Game.start({ mode: "shift", shiftIdx: 0, cols: 9, rows: 12, mines: 18, canaries: 1 });
  Game.dig(0);
  let mine = -1;
  for (let i = 0; i < Game.n; i++) if (Game.board.mine[i] && !Game.rev[i]) { mine = i; break; }
  assert.ok(mine >= 0);

  Game.dig(mine);
  assert.equal(Game.state, "playing", "the first strike should cost the bird, not the shift");
  assert.equal(Game.canaries, 0);
  assert.equal(Game.mk[mine], 1, "and it should leave the gas marked");
  assert.equal(Game.penalty, S.CANARY_PENALTY);

  let other = -1;
  for (let i = 0; i < Game.n; i++) if (Game.board.mine[i] && !Game.rev[i] && !Game.mk[i]) { other = i; break; }
  Game.dig(other);
  assert.equal(Game.state, "lost", "with the cage empty the next strike ends it");
});

test("free-dig sizes are all finishable and span a real range of work", () => {
  const taps = [];
  for (const z of SIZES) {
    const runs = sweep(
      () => ({ mode: "free", sizeId: z.id, cols: z.cols, rows: z.rows, mines: z.mines, canaries: z.canaries }),
      () => makeBrain("perfect"), 3);
    assert.equal(rate(runs), 1, `${z.name} should always fall to perfect reasoning`);
    taps.push(mean(runs, (r) => r.taps));
  }
  assert.ok(taps[2] > taps[0] * 2.5, `the big size should be real work: ${taps.map((t) => t.toFixed(0)).join(" / ")} taps`);
});

test("the engine survives being driven past the end of a shift", () => {
  S.__reseed(12);
  Game.start(shiftCfg(0));
  Game.dig(5);
  while (Game.running()) {
    const { safe, mines } = deduce(Game);
    if (!safe.size && !mines.size) break;
    for (const i of mines) Game.mark(i);
    for (const i of safe) Game.dig(i);
  }
  assert.equal(Game.state, "won");
  const before = { rev: Game.revealed, time: Game.clock() };
  Game.dig(0); Game.mark(1); Game.chord(2); Game.sendCanary();
  Game.tick(10);
  assert.equal(Game.revealed, before.rev, "nothing may change after the shift is over");
  assert.equal(Game.clock(), before.time, "and the clock must stop");
});