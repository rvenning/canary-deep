// The campaign: eighteen shifts down three seams, plus the free-play sizes and
// the Daily Seam.
//
// Boards stay at most 13 columns wide on purpose. A phone held upright gives
// roughly 375 usable pixels, so 13 columns is a 28px cell — about the smallest
// square an adult thumb can hit reliably. Depth grows downward instead, which
// costs nothing: the board scrolls nowhere, it just gets taller.
//
// Difficulty is mine DENSITY, which runs 11% at the day hole to 27% at the last
// shift. For comparison, classic Expert is 20.6%. Densities that high are only
// playable at all because every board is filtered to be solvable by logic —
// past about 30% the generator can no longer find fair boards, so 27% is the
// floor of the cliff rather than an arbitrary stopping point.
//
// `canaries` is how many birds you carry in. Two while you are learning the
// patterns, one once the seam gets serious.

const SEAMS = [
  { name: "Surface Cuttings", icon: "⛏️", edge: "#c98b3a",
    blurb: "Daylight at your back and the seam near the surface. This is where you learn to read the numbers." },
  { name: "The Deep Drifts", icon: "🔦", edge: "#4f9bd6",
    blurb: "Past the shaft bottom. The gas gets thicker and the cage carries one bird." },
  { name: "The Blackwater Level", icon: "💧", edge: "#8b6ad6",
    blurb: "The oldest workings in the pit. Denser than Expert, and still never a guess." },
];

const SHIFTS = [
  // ---------------------------------------------------- Surface Cuttings --
  { seam: 0, name: "Day Hole",       cols: 7,  rows: 9,  mines: 7,  canaries: 2,
    hint: "Tap to dig. A number counts the gas in the eight squares touching it." },
  { seam: 0, name: "Bell Pit",       cols: 8,  rows: 10, mines: 11, canaries: 2,
    hint: "Hold a square to peg a marker on it — or flip to 🚩 mode with the button." },
  { seam: 0, name: "Drift Mouth",    cols: 8,  rows: 11, mines: 14, canaries: 2,
    hint: "Tap a number you have fully marked and it clears everything else around it at once." },
  { seam: 0, name: "Candle Row",     cols: 9,  rows: 12, mines: 18, canaries: 2,
    hint: "A 1 beside a 1 along a wall: the far square is always clean air." },
  { seam: 0, name: "Pony Road",      cols: 9,  rows: 13, mines: 22, canaries: 2,
    hint: "Stuck? Send a canary. It always lands somewhere you could have worked out yourself." },
  { seam: 0, name: "The Long Wall",  cols: 10, rows: 14, mines: 27, canaries: 2,
    hint: "1-2-1 along an edge is gas, air, gas. Learn it here and you will see it everywhere." },

  // ----------------------------------------------------- The Deep Drifts --
  { seam: 1, name: "Shaft Bottom",   cols: 10, rows: 15, mines: 30, canaries: 2,
    hint: "The counter at the top is the mines you have NOT marked. It solves more endings than you think." },
  { seam: 1, name: "Pit Props",      cols: 11, rows: 15, mines: 34, canaries: 2,
    hint: "When two numbers overlap, subtract the smaller from the larger and read what is left." },
  { seam: 1, name: "Firedamp",       cols: 11, rows: 16, mines: 38, canaries: 1,
    hint: "One bird from here down. Spend it and you keep two stars, not three." },
  { seam: 1, name: "The Gob",        cols: 11, rows: 17, mines: 42, canaries: 1,
    hint: "Corners first. A corner square touches three others, so its number tells you far more." },
  { seam: 1, name: "Blackdamp",      cols: 12, rows: 18, mines: 49, canaries: 1,
    hint: "Work the edge of what you have opened rather than hunting across the dark." },
  { seam: 1, name: "Cage Landing",   cols: 12, rows: 19, mines: 53, canaries: 1,
    hint: "Marking is not just bookkeeping — you cannot clear a number in one tap until it is marked." },

  // ------------------------------------------------ The Blackwater Level --
  { seam: 2, name: "Flooded Heading", cols: 12, rows: 20, mines: 57, canaries: 1,
    hint: "Denser than Expert from here on. Still solvable, still never a guess." },
  { seam: 2, name: "Rotten Roof",     cols: 13, rows: 20, mines: 62, canaries: 1,
    hint: "When nothing local works, count what is left against the squares still dark." },
  { seam: 2, name: "The Coal Face",   cols: 13, rows: 21, mines: 67, canaries: 1,
    hint: "Openings are small down here. Every number you turn over is worth reading twice." },
  { seam: 2, name: "The Sump",        cols: 13, rows: 21, mines: 70, canaries: 1,
    hint: "A quarter of this seam is gas. Slow is fast." },
  { seam: 2, name: "Old Workings",    cols: 13, rows: 22, mines: 74, canaries: 1,
    hint: "Nobody has cut here in ninety years. Mind where you put your feet." },
  { seam: 2, name: "The Last Shift",  cols: 13, rows: 22, mines: 78, canaries: 1,
    hint: "27% gas. The deepest board the pit can deal you and still promise it is fair." },
];

// Free play: three sizes, endless boards, and a best time kept for each.
const SIZES = [
  { id: "cutting",    name: "Cutting",    icon: "⛏️", cols: 9,  rows: 12, mines: 18, canaries: 1 },
  { id: "drift",      name: "Drift",      icon: "🔦", cols: 11, rows: 16, mines: 38, canaries: 1 },
  { id: "blackwater", name: "Blackwater", icon: "💧", cols: 13, rows: 22, mines: 74, canaries: 1 },
];

// The Daily Seam: the same board for everyone, every day, and one attempt at
// it. Its opening dig is already made when you arrive, because a board is only
// identical for two people if they started in the same square.
const DAILY = { cols: 11, rows: 16, mines: 38, canaries: 1 };

// The target time, computed from the board the player was actually dealt
// rather than from a flat rate per shift.
//
// `actions` is what the solver had to DECIDE — each square it proved safe or
// proved to be gas — and ignores everything that fell open for free in a
// flood. So it is very close to the number of taps a person makes, which makes
// par mean the same thing on a lucky board and an awkward one. 0.8s per
// decision is a brisk but unhurried pace; the base covers reading the board
// when you first arrive.
function parFor(actions) { return Math.round((5 + 0.8 * actions) * 10) / 10; }

// 1 star for getting out alive, 2 for beating par, 3 for beating par with
// every bird still in the cage.
function starsFor(res) {
  if (!res.cleared) return 0;
  let s = 1;
  if (res.time <= res.par) s = 2;
  if (s === 2 && res.canariesLeft >= res.canariesStart) s = 3;
  return s;
}

if (typeof window === "undefined") Object.assign(globalThis, { SEAMS, SHIFTS, SIZES, DAILY, parFor, starsFor });