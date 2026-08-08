// Seed Math.random inside the sandbox so a failing balance test means a real
// change and not a bad roll.
//
// The seeded generator only exists IN HERE — the test file itself runs in
// Node's own realm with a different, unseeded Math.random — so a bot that makes
// its own random choices must route them through __rand(), or the suite passes
// and fails at random while looking perfectly deterministic.
(function () {
  let a = 0x9e3779b9;
  function mulberry32() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  Math.random = mulberry32;
  globalThis.__reseed = function (n) { a = (n >>> 0) || 1; };
  globalThis.__rand = function () { return Math.random(); };
})();