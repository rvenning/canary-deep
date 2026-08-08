// Persistence — gamekit storage configured for Canary Deep.
// cnry_* localStorage keys, "canarydeep" Firestore collection.
//
// There is no spendable currency in this game, so every number here is
// monotonic and merges by keeping the better of the two: more stars, fewer
// seconds, more seams cleared. That makes cross-device reconciliation boring,
// which is exactly what you want of it.
//
// The one field that is not a "best of" is the Daily Seam. You get one attempt
// at it, so two devices meeting must not let a second, better-informed attempt
// quietly replace the first — the record carries the moment it was set and the
// EARLIER one always wins, whichever device happens to sync last.
//
// blank/merge are named before being handed to createStorage, because
// createStorage keeps them in a closure and never exposes them, and merge is
// the one function here that can permanently destroy a save.

const PROGRESS = {
  blank: () => ({
    shifts: {},        // { [shiftIdx]: { stars, time } } — best result per shift
    free: {},          // { [sizeId]: { best, wins, plays } }
    daily: null,       // { date, cleared, time, stars, at } — today's one attempt
    dailyPlayed: 0,
    dailyCleared: 0,
    bestDaily: 0,      // quickest Daily Seam ever cleared, in seconds
    shiftsPlayed: 0,
    canariesLost: 0,
    updated: 0,
  }),

  merge: (a, b) => {
    const shifts = { ...(a.shifts || {}) };
    for (const [idx, r] of Object.entries(b.shifts || {})) {
      const cur = shifts[idx];
      if (!cur) { shifts[idx] = r; continue; }
      shifts[idx] = {
        stars: Math.max(cur.stars || 0, r.stars || 0),
        time: Math.min(cur.time || 1e9, r.time || 1e9),
      };
    }

    const free = { ...(a.free || {}) };
    for (const [id, r] of Object.entries(b.free || {})) {
      const cur = free[id];
      if (!cur) { free[id] = r; continue; }
      free[id] = {
        best: Math.min(cur.best || 1e9, r.best || 1e9),
        wins: Math.max(cur.wins || 0, r.wins || 0),
        plays: Math.max(cur.plays || 0, r.plays || 0),
      };
    }

    // One attempt a day: same date, the earlier attempt stands. Different
    // dates, the later day is the one that matters, because yesterday is over.
    let daily = a.daily || null;
    if (b.daily) {
      if (!daily) daily = b.daily;
      else if (b.daily.date > daily.date) daily = b.daily;
      else if (b.daily.date === daily.date && (b.daily.at || 0) < (daily.at || 0)) daily = b.daily;
    }

    const better = (x, y) => (x > 0 && y > 0 ? Math.min(x, y) : Math.max(x || 0, y || 0));

    return {
      // Spread first so a field a newer build added survives an older client's
      // merge, then pin everything we know how to reconcile.
      ...a, ...b,
      shifts, free, daily,
      dailyPlayed: Math.max(a.dailyPlayed || 0, b.dailyPlayed || 0),
      dailyCleared: Math.max(a.dailyCleared || 0, b.dailyCleared || 0),
      bestDaily: better(a.bestDaily || 0, b.bestDaily || 0),
      shiftsPlayed: Math.max(a.shiftsPlayed || 0, b.shiftsPlayed || 0),
      canariesLost: Math.max(a.canariesLost || 0, b.canariesLost || 0),
    };
  },
};

const Storage = GK.createStorage({
  prefix: "cnry",
  collection: "canarydeep",
  firebaseConfig: window.FIREBASE_CONFIG,
  blankProgress: PROGRESS.blank,
  mergeProgress: PROGRESS.merge,
});

Object.assign(Storage, {
  totalStars(p) {
    return Object.values(p.shifts || {}).reduce((s, r) => s + (r.stars || 0), 0);
  },

  cleared(p) { return Object.keys(p.shifts || {}).length; },

  // Shifts open in order: the one after the deepest you have finished.
  unlocked(p) {
    let max = -1;
    for (const k of Object.keys(p.shifts || {})) max = Math.max(max, Number(k));
    return Math.min(max + 1, SHIFTS.length - 1);
  },

  campaignDone(p) { return this.cleared(p) >= SHIFTS.length; },

  recordShift(profileId, res) {
    const prog = this.getProgress(profileId);
    prog.shiftsPlayed = (prog.shiftsPlayed || 0) + 1;
    prog.canariesLost = (prog.canariesLost || 0) + (res.canariesStart - res.canariesLeft);
    if (res.cleared) {
      const cur = prog.shifts[res.shiftIdx];
      if (!cur) prog.shifts[res.shiftIdx] = { stars: res.stars, time: res.time };
      else {
        cur.stars = Math.max(cur.stars || 0, res.stars);
        cur.time = Math.min(cur.time || 1e9, res.time);
      }
    }
    this.saveProgress(profileId, prog);
    return prog;
  },

  recordFree(profileId, res) {
    const prog = this.getProgress(profileId);
    const cur = (prog.free[res.sizeId] = prog.free[res.sizeId] || { best: 0, wins: 0, plays: 0 });
    cur.plays++;
    if (res.cleared) {
      cur.wins++;
      if (!cur.best || res.time < cur.best) cur.best = res.time;
    }
    prog.canariesLost = (prog.canariesLost || 0) + (res.canariesStart - res.canariesLeft);
    this.saveProgress(profileId, prog);
    return prog;
  },

  /* ---------------------------------------------------------- daily seam -- */

  dailyFor(p, date) { return p.daily && p.daily.date === date ? p.daily : null; },

  recordDaily(profileId, res, now = Date.now()) {
    const prog = this.getProgress(profileId);
    if (prog.daily && prog.daily.date === res.date) return prog;   // one attempt, already taken
    prog.daily = { date: res.date, cleared: !!res.cleared, time: res.time, stars: res.stars, at: now };
    prog.dailyPlayed = (prog.dailyPlayed || 0) + 1;
    if (res.cleared) {
      prog.dailyCleared = (prog.dailyCleared || 0) + 1;
      if (!prog.bestDaily || res.time < prog.bestDaily) prog.bestDaily = res.time;
    }
    prog.canariesLost = (prog.canariesLost || 0) + (res.canariesStart - res.canariesLeft);
    this.saveProgress(profileId, prog);
    return prog;
  },

  // Today's standings across the family — everyone played the same board, so
  // this is the one number in the game that compares directly.
  dailyBoard(date) {
    const rows = [];
    for (const p of this.getProfiles()) {
      const d = this.getProgress(p.id).daily;
      if (d && d.date === date) rows.push({ profile: p, entry: d });
    }
    return rows.sort((x, y) =>
      (y.entry.cleared ? 1 : 0) - (x.entry.cleared ? 1 : 0) || x.entry.time - y.entry.time);
  },
});