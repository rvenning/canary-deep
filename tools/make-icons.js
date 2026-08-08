// Generate icons/ — a canary in a brass cage, hanging in the dark.
// Run: node tools/make-icons.js  (from the canary-deep folder)
const fs = require("fs");
const path = require("path");
const { makeCanvas, downsample, encodePNG } = require("../lib/tools/png.js");

const OUT = path.join(__dirname, "..", "icons");
fs.mkdirSync(OUT, { recursive: true });

function paint(size, pad) {
  const SS = 4, big = size * SS;
  const cv = makeCanvas(big);
  const u = big / 100;

  const ROCK = "#141c25";
  const BRASS = "#c99a3a", BRASS2 = "#e8bd5c";
  const BIRD = "#ffc23d", BIRD2 = "#ffe08a", BEAK = "#e8843a", EYE = "#241a05";

  cv.fillRect(0, 0, big, big, ROCK);
  // A lamp glow above, so the cage reads as hanging in a working. Stepped
  // rather than smooth, but each step is close enough to the last to read as a
  // fade instead of as ripples.
  const glow = ["#161f29", "#18222d", "#1a2531", "#1c2835", "#1e2b39"];
  for (let i = glow.length - 1; i >= 0; i--) cv.fillCircle(50 * u, 14 * u, (26 - i * 4) * u, glow[i]);

  const s = pad ? 0.74 : 1;
  const at = (v) => 50 * u + (v - 50) * u * s;
  const sz = (v) => v * u * s;

  // Hook and hanging bar.
  cv.fillRect(at(48.5), at(8), sz(3), sz(10), BRASS);
  cv.fillRect(at(26), at(18), sz(48), sz(5), BRASS2);

  // Cage body: a dark interior with brass bars over it.
  cv.fillRect(at(28), at(23), sz(44), sz(52), "#0d131a");
  for (let x = 30; x <= 70; x += 8) cv.fillRect(at(x), at(23), sz(3), sz(52), BRASS);
  cv.fillRect(at(26), at(73), sz(48), sz(6), BRASS2);

  // The bird on its perch.
  cv.fillCircle(at(50), at(52), sz(13), BIRD);
  cv.fillCircle(at(50), at(38), sz(8.5), BIRD);
  cv.fillCircle(at(46), at(48), sz(8), BIRD2);
  cv.fillCircle(at(53.5), at(36), sz(2), EYE);
  cv.fillRect(at(57), at(37), sz(6), sz(3.5), BEAK);
  cv.fillRect(at(44), at(63), sz(2.5), sz(6), BEAK);
  cv.fillRect(at(53), at(63), sz(2.5), sz(6), BEAK);
  cv.fillRect(at(38), at(68), sz(24), sz(3), BRASS2);

  return encodePNG(size, size, downsample(cv.px, big, SS));
}

fs.writeFileSync(path.join(OUT, "icon-192.png"), paint(192, false));
fs.writeFileSync(path.join(OUT, "icon-512.png"), paint(512, false));
fs.writeFileSync(path.join(OUT, "maskable-512.png"), paint(512, true));
console.log("icons written to", OUT);