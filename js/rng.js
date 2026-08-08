// Deterministic randomness for dealing boards.
//
// The rule the family games follow: never draw from a running stream. Derive a
// generator from what the draw is FOR — RNG.sub(seed, "daily") — so nothing
// depends on how much was generated before it.
//
// Here it buys one specific thing, and it is the whole point of the Daily
// Seam: a date maps to a seed, a seed maps to a board and to the square the
// opening dig is made in, and everybody in the family therefore plays the same
// board from the same opening whatever order they play it in.

const RNG = {
  // FNV-1a: any string to a 32-bit seed. "2026-08-09" is today's seam.
  seedFrom(str) {
    const s = String(str);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },

  make(seed = 0) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    return next;
  },

  sub(seed, ...parts) {
    return RNG.make((seed ^ RNG.seedFrom(parts.join("|"))) >>> 0);
  },

  // Today's date on the player's own calendar — that is the board they get.
  today(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { RNG });