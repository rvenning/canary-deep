// Game sounds, layered on gamekit's defaults. Everything is synthesized — no
// files to load, nothing to cache, and it all works offline.
//
// The palette is deliberately dry and wooden, because this game is played in
// long quiet stretches and a bright arcade blip becomes unbearable after two
// hundred taps. The only sounds allowed to be pretty are the canary's.

const Sfx = GK.Sfx;

Object.assign(Sfx, {
  // The pick going in. A wide opening gets a lower, longer knock, so a big
  // flood feels like it opened something rather than like a louder tap.
  dig(n = 1) {
    const big = Math.min(1, (n - 1) / 24);
    this.tone({ freq: 320 - big * 110, type: "triangle", dur: 0.05 + big * 0.07, vol: 0.09 + big * 0.05 });
    if (n > 6) this.noise({ dur: 0.16 + big * 0.2, vol: 0.05 + big * 0.05 });
  },

  mark() {
    this.tone({ freq: 520, type: "square", dur: 0.04, vol: 0.07 });
    this.tone({ freq: 780, type: "square", dur: 0.05, vol: 0.05, when: 0.035 });
  },

  unmark() { this.tone({ freq: 380, type: "square", dur: 0.05, vol: 0.06, slide: -90 }); },

  // The bird sent ahead: a rising three-note chirp, then the little knock of
  // the square it landed on.
  canarySent() {
    [880, 1180, 1480].forEach((f, i) =>
      this.tone({ freq: f, type: "sine", dur: 0.07, vol: 0.11, when: i * 0.06, slide: 120 }));
  },

  // The bird taking the hit for you. Falling, and then quiet.
  canaryDown() {
    [1320, 990, 660].forEach((f, i) =>
      this.tone({ freq: f, type: "sine", dur: 0.13, vol: 0.13, when: i * 0.09, slide: -160 }));
    this.noise({ dur: 0.3, vol: 0.07, when: 0.2 });
  },

  boom() {
    this.noise({ dur: 0.7, vol: 0.3 });
    this.tone({ freq: 90, type: "sawtooth", dur: 0.6, vol: 0.22, slide: -45 });
    this.tone({ freq: 55, type: "sine", dur: 0.9, vol: 0.18, slide: -20 });
  },

  clear() {
    const notes = [392, 494, 587, 784, 988];
    notes.forEach((f, i) => this.tone({ freq: f, type: "triangle", dur: 0.3, vol: 0.2, when: i * 0.11 }));
    notes.forEach((f, i) => this.tone({ freq: f / 2, type: "sine", dur: 0.34, vol: 0.11, when: i * 0.11 }));
  },

  star(n = 1) {
    this.tone({ freq: 620 + n * 200, type: "triangle", dur: 0.2, vol: 0.2, slide: 160 });
  },

  newBest() {
    [784, 988, 1175, 1568].forEach((f, i) =>
      this.tone({ freq: f, type: "square", dur: 0.13, vol: 0.13, when: i * 0.1 }));
  },
});