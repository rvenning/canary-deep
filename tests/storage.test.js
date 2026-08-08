// The cross-device merge. This is the one function in the game that can
// permanently destroy a save — two devices meet, one holds a worse copy, and
// whatever the merge drops is gone from both — so it is tested directly rather
// than through the game.
//
// It also holds the game's one non-monotonic rule: the Daily Seam is a single
// attempt, so a second attempt made on another device must not be allowed to
// overwrite the first, whichever device happens to sync last.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");
const S = loadScripts({
  baseDir: ROOT,
  files: ["js/shifts.js", "lib/gk-util.js", "lib/gk-storage.js", "js/storage.js"],
  exports: ["PROGRESS", "Storage", "SHIFTS"],
  // firebase-config.js is deliberately not loaded: with no window.FIREBASE_CONFIG
  // the storage object runs on localStorage alone, which is all the merge needs.
  browser: true,
});

const { PROGRESS, Storage, SHIFTS } = S;
const blank = () => PROGRESS.blank();

test("a blank save merged with itself changes nothing", () => {
  const a = blank(), b = blank();
  assert.deepEqual(PROGRESS.merge(a, b), { ...blank(), ...blank() });
});

test("shift results keep the better stars and the quicker time, per shift", () => {
  const a = blank(), b = blank();
  a.shifts = { 0: { stars: 3, time: 40 }, 1: { stars: 1, time: 200 } };
  b.shifts = { 0: { stars: 1, time: 25 }, 2: { stars: 2, time: 90 } };
  const m = PROGRESS.merge(a, b);
  assert.deepEqual(m.shifts[0], { stars: 3, time: 25 }, "best of each field, not the better record whole");
  assert.deepEqual(m.shifts[1], { stars: 1, time: 200 }, "a shift only one device has must survive");
  assert.deepEqual(m.shifts[2], { stars: 2, time: 90 });
});

test("free-dig bests take the quicker time and never resurrect a zero", () => {
  const a = blank(), b = blank();
  a.free = { cutting: { best: 0, wins: 0, plays: 3 } };
  b.free = { cutting: { best: 61.5, wins: 1, plays: 1 }, drift: { best: 300, wins: 1, plays: 1 } };
  const m = PROGRESS.merge(a, b);
  assert.equal(m.free.cutting.best, 61.5, "an unset best must not beat a real one");
  assert.equal(m.free.cutting.plays, 3);
  assert.equal(m.free.cutting.wins, 1);
  assert.equal(m.free.drift.best, 300);
});

test("the Daily Seam keeps the FIRST attempt of the day, not the better one", () => {
  const a = blank(), b = blank();
  a.daily = { date: "2026-08-09", cleared: false, time: 30, stars: 0, at: 1000 };
  b.daily = { date: "2026-08-09", cleared: true, time: 44, stars: 3, at: 5000 };
  assert.deepEqual(PROGRESS.merge(a, b).daily, a.daily, "the later attempt must not stand in for the first");
  assert.deepEqual(PROGRESS.merge(b, a).daily, a.daily, "and the answer must not depend on which side is which");
});

test("a new day replaces yesterday's daily", () => {
  const a = blank(), b = blank();
  a.daily = { date: "2026-08-08", cleared: true, time: 50, stars: 2, at: 10 };
  b.daily = { date: "2026-08-09", cleared: false, time: 12, stars: 0, at: 20 };
  assert.equal(PROGRESS.merge(a, b).daily.date, "2026-08-09");
  assert.equal(PROGRESS.merge(b, a).daily.date, "2026-08-09");
});

test("bestDaily takes the quicker of two real times, and ignores an unset one", () => {
  const a = blank(), b = blank();
  a.bestDaily = 0; b.bestDaily = 77;
  assert.equal(PROGRESS.merge(a, b).bestDaily, 77);
  a.bestDaily = 91;
  assert.equal(PROGRESS.merge(a, b).bestDaily, 77);
});

test("a field a newer build added survives an older client's merge", () => {
  const a = { ...blank(), somethingNew: [1, 2, 3] };
  const m = PROGRESS.merge(a, blank());
  assert.deepEqual(m.somethingNew, [1, 2, 3]);
});

test("merging is idempotent — syncing twice must not drift", () => {
  const a = blank();
  a.shifts = { 0: { stars: 2, time: 40 } };
  a.free = { drift: { best: 120, wins: 2, plays: 5 } };
  a.daily = { date: "2026-08-09", cleared: true, time: 44, stars: 3, at: 5 };
  a.dailyCleared = 4; a.bestDaily = 44;
  const once = PROGRESS.merge(a, blank());
  const twice = PROGRESS.merge(once, blank());
  assert.deepEqual(twice, once);
});

test("progress helpers read the save the way the map screen does", () => {
  const p = blank();
  p.shifts = { 0: { stars: 3, time: 10 }, 1: { stars: 2, time: 20 }, 2: { stars: 1, time: 30 } };
  assert.equal(Storage.totalStars(p), 6);
  assert.equal(Storage.cleared(p), 3);
  assert.equal(Storage.unlocked(p), 3, "the shift after the deepest one finished");
  assert.equal(Storage.campaignDone(p), false);

  const fresh = blank();
  assert.equal(Storage.unlocked(fresh), 0, "a new miner starts at the first shift");

  const all = blank();
  for (let i = 0; i < SHIFTS.length; i++) all.shifts[i] = { stars: 3, time: 5 };
  assert.equal(Storage.campaignDone(all), true);
  assert.equal(Storage.unlocked(all), SHIFTS.length - 1, "and never past the end of the table");
});