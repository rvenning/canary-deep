// The deduction engine. This is the most important file in the game, because
// it is what "no board ever needs a guess" actually MEANS: a board is only
// dealt to the player if this solver can finish it from the opening dig using
// nothing but logic. The solver is the definition, the generator is the filter.
//
// Four rules, cheapest first, and nothing runs until everything above it has
// stopped making progress:
//
//   1. Counting     — a number with its mines already found has only safe
//                     neighbours left; a number with exactly as many unknowns
//                     left as mines missing has only mines left.
//   2. Subsets      — if one number's unknowns are a subset of another's, the
//                     cells in the difference carry the difference in mines.
//                     This is every 1-1 and 1-2-1 pattern a person knows.
//   3. The counter  — the mines-remaining readout. Zero left means everything
//                     is safe; as many left as there are unknowns means the
//                     rest are all mines.
//   4. Enumeration  — split the frontier into independent groups, try every
//                     legal arrangement of each, and keep what is true in all
//                     of them, filtered by whether the mines left over can
//                     actually be spread across the other groups and the
//                     untouched dark. This is the endgame reasoning a good
//                     player does out loud, and it is bounded so it stays fast.
//
// Rules 1-3 are cheap and do most of the work; rule 4 is the one that lets the
// generator accept a board instead of throwing it away, which is why the
// dealing is fast enough to happen on the player's first tap.
//
// Soundness matters more than strength here. A solver that is too weak only
// makes the generator work harder; a solver that deduces something FALSE deals
// a board that kills the player through no fault of their own. Every rule
// below is only allowed to conclude what holds in every consistent world.

const Solver = {
  MAX_ENUM: 22,        // cells in a group we are willing to enumerate
  MAX_NODES: 120000,   // search nodes before we give up on a group

  newState(board) {
    return {
      rev: new Uint8Array(board.n),   // 1 = dug, and its number is visible
      mk: new Uint8Array(board.n),    // 1 = proved to be a mine
      revealed: 0,
      marked: 0,
    };
  },

  // Dig a cell, flooding outward through zeroes the way the game does.
  // Returns how many cells opened, or -1 if the cell held a mine.
  reveal(board, st, i) {
    if (st.rev[i]) return 0;
    if (board.mine[i]) return -1;
    const stack = [i];
    let count = 0;
    while (stack.length) {
      const k = stack.pop();
      if (st.rev[k]) continue;
      st.rev[k] = 1;
      st.revealed++;
      count++;
      if (board.num[k] === 0) {
        for (const j of board.nbr[k]) if (!st.rev[j]) stack.push(j);
      }
    }
    return count;
  },

  mark(board, st, i) {
    if (st.mk[i] || st.rev[i]) return false;
    st.mk[i] = 1;
    st.marked++;
    return true;
  },

  won(board, st) { return st.revealed === board.n - board.mines; },

  // Every dug number that still has unknown neighbours, as {cells, need}.
  constraints(board, st) {
    const out = [];
    for (let i = 0; i < board.n; i++) {
      if (!st.rev[i]) continue;
      let need = board.num[i];
      let cells = null;
      for (const j of board.nbr[i]) {
        if (st.mk[j]) need--;
        else if (!st.rev[j]) (cells || (cells = [])).push(j);
      }
      if (cells) out.push({ cells, need });
    }
    return out;
  },

  /* ------------------------------------------------------------ rule 1-3 -- */

  // Deductions are collected and applied by the caller rather than mid-pass:
  // mutating the state invalidates the constraint list we are reading from.
  ruleCount(cons, safe, mines) {
    for (const k of cons) {
      if (k.need === 0) { for (const j of k.cells) safe.add(j); }
      else if (k.need === k.cells.length) { for (const j of k.cells) mines.add(j); }
    }
  },

  ruleSubset(cons, safe, mines) {
    // Only pairs that actually share a cell can be subsets of one another, so
    // walk the shared-cell index rather than all pairs. Each constraint's cell
    // Set is built once — rebuilding it inside the loop turns a cheap rule into
    // the hot spot of the whole generator.
    const sets = cons.map((k) => new Set(k.cells));
    const byCell = new Map();
    for (let a = 0; a < cons.length; a++) {
      for (const j of cons[a].cells) {
        let list = byCell.get(j);
        if (!list) byCell.set(j, (list = []));
        list.push(a);
      }
    }
    for (let a = 0; a < cons.length; a++) {
      const A = cons[a], setA = sets[a];
      const seen = new Set([a]);
      for (const j of A.cells) {
        for (const b of byCell.get(j)) {
          if (seen.has(b)) continue;
          seen.add(b);
          const B = cons[b], setB = sets[b];
          if (B.cells.length <= A.cells.length) continue;
          let subset = true;
          for (const x of A.cells) if (!setB.has(x)) { subset = false; break; }
          if (!subset) continue;
          const diff = B.cells.filter((x) => !setA.has(x));
          const needDiff = B.need - A.need;
          if (needDiff === 0) { for (const x of diff) safe.add(x); }
          else if (needDiff === diff.length) { for (const x of diff) mines.add(x); }
        }
      }
    }
  },

  ruleTotal(board, st, safe, mines) {
    const left = board.mines - st.marked;
    const unknown = [];
    for (let i = 0; i < board.n; i++) if (!st.rev[i] && !st.mk[i]) unknown.push(i);
    if (left === 0) { for (const i of unknown) safe.add(i); }
    else if (left === unknown.length) { for (const i of unknown) mines.add(i); }
  },

  /* -------------------------------------------------------------- rule 4 -- */

  // Split the frontier into groups that share no constraint, so each can be
  // enumerated on its own. Cells not touching any dug number are "dark" — they
  // are constrained only by the mines-remaining counter.
  groups(cons) {
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (x, y) => { const a = find(x), b = find(y); if (a !== b) parent.set(a, b); };

    for (const k of cons) for (const j of k.cells) if (!parent.has(j)) parent.set(j, j);
    for (const k of cons) for (let i = 1; i < k.cells.length; i++) union(k.cells[0], k.cells[i]);

    const byRoot = new Map();
    for (const j of parent.keys()) {
      const r = find(j);
      let g = byRoot.get(r);
      if (!g) byRoot.set(r, (g = { cells: [], cons: [] }));
      g.cells.push(j);
    }
    for (const k of cons) byRoot.get(find(k.cells[0])).cons.push(k);
    return [...byRoot.values()];
  },

  // Every legal mine arrangement of one group, summarised as: for each possible
  // number of mines k, how many arrangements have that many, and how often each
  // cell was a mine among them. Returns null if the group is too big to search.
  enumerate(group) {
    const cells = group.cells;
    const m = cells.length;
    if (m > this.MAX_ENUM) return null;

    const pos = new Map();
    cells.forEach((c, i) => pos.set(c, i));

    // Per constraint: the group-local cell indices it covers, and how many
    // mines it wants. Ordering the cells by "most constrained first" makes the
    // pruning bite early.
    const cs = group.cons.map((k) => ({ need: k.need, idx: k.cells.map((c) => pos.get(c)) }));
    const consOf = Array.from({ length: m }, () => []);
    cs.forEach((k, ci) => { for (const i of k.idx) consOf[i].push(ci); });

    const have = new Int32Array(cs.length);      // mines placed so far
    const left = Int32Array.from(cs.map((k) => k.idx.length)); // cells not yet decided
    const assign = new Uint8Array(m);
    const perK = new Map();
    let nodes = 0;
    let overflow = false;

    const step = (i, used) => {
      if (overflow) return;
      if (++nodes > this.MAX_NODES) { overflow = true; return; }
      if (i === m) {
        let rec = perK.get(used);
        if (!rec) perK.set(used, (rec = { sols: 0, mineCount: new Int32Array(m) }));
        rec.sols++;
        for (let x = 0; x < m; x++) if (assign[x]) rec.mineCount[x]++;
        return;
      }
      for (const v of [0, 1]) {
        let ok = true;
        for (const ci of consOf[i]) {
          const nh = have[ci] + v, nl = left[ci] - 1;
          if (nh > cs[ci].need || nh + nl < cs[ci].need) { ok = false; break; }
        }
        if (!ok) continue;
        for (const ci of consOf[i]) { have[ci] += v; left[ci]--; }
        assign[i] = v;
        step(i + 1, used + v);
        assign[i] = 0;
        for (const ci of consOf[i]) { have[ci] -= v; left[ci]++; }
      }
    };
    step(0, 0);
    if (overflow) return null;
    return { cells, perK };
  },

  // Which totals a list of per-group mine-count sets can add up to.
  sums(sets) {
    let acc = new Set([0]);
    for (const s of sets) {
      const next = new Set();
      for (const a of acc) for (const b of s) next.add(a + b);
      acc = next;
      if (acc.size > 4000) break;   // pathological; the caller only needs a superset
    }
    return acc;
  },

  ruleEnumerate(board, st, cons, safe, mines) {
    const gs = this.groups(cons);
    if (!gs.length) return;

    const inGroup = new Set();
    for (const g of gs) for (const c of g.cells) inGroup.add(c);
    let dark = 0;
    for (let i = 0; i < board.n; i++) if (!st.rev[i] && !st.mk[i] && !inGroup.has(i)) dark++;

    const left = board.mines - st.marked;

    // Enumerate what we can. A group we cannot search still constrains the
    // budget, so stand in for it with the widest range it could possibly take —
    // that only ever makes us deduce LESS, never something false.
    const info = gs.map((g) => {
      const e = this.enumerate(g);
      if (e) return { e, ks: new Set(e.perK.keys()) };
      const ks = new Set();
      for (let k = 0; k <= g.cells.length; k++) ks.add(k);
      return { e: null, ks };
    });

    for (let gi = 0; gi < gs.length; gi++) {
      const self = info[gi];
      if (!self.e) continue;
      const rest = this.sums(info.filter((_, j) => j !== gi).map((x) => x.ks));

      // A count k is only real if the remaining mines can be spread over the
      // other groups and the dark without going negative or overflowing.
      const feasible = [];
      for (const k of self.e.perK.keys()) {
        for (const s of rest) {
          const outside = left - k - s;
          if (outside >= 0 && outside <= dark) { feasible.push(k); break; }
        }
      }
      if (!feasible.length) continue;

      let sols = 0;
      const mineCount = new Int32Array(self.e.cells.length);
      for (const k of feasible) {
        const rec = self.e.perK.get(k);
        sols += rec.sols;
        for (let x = 0; x < mineCount.length; x++) mineCount[x] += rec.mineCount[x];
      }
      if (!sols) continue;
      self.e.cells.forEach((cell, x) => {
        if (mineCount[x] === 0) safe.add(cell);
        else if (mineCount[x] === sols) mines.add(cell);
      });
    }

    // And the dark itself: if every arrangement the frontier allows already
    // spends all the mines, everywhere untouched is safe (and vice versa).
    if (dark > 0) {
      const all = this.sums(info.map((x) => x.ks));
      let minOut = Infinity, maxOut = -Infinity;
      for (const s of all) {
        const outside = left - s;
        if (outside < 0 || outside > dark) continue;
        minOut = Math.min(minOut, outside);
        maxOut = Math.max(maxOut, outside);
      }
      if (maxOut === 0) {
        for (let i = 0; i < board.n; i++) if (!st.rev[i] && !st.mk[i] && !inGroup.has(i)) safe.add(i);
      } else if (minOut === dark && minOut !== Infinity) {
        for (let i = 0; i < board.n; i++) if (!st.rev[i] && !st.mk[i] && !inGroup.has(i)) mines.add(i);
      }
    }
  },

  /* ---------------------------------------------------------------- run -- */

  // Play the board out by logic alone from the state given.
  //
  // `actions` counts the decisions a person would have to make: every cell
  // proved safe or proved to be a mine, plus the opening dig. Cells that come
  // free in a flood are not decisions and are not counted — which is what makes
  // it a fair basis for the par time.
  run(board, st, opts = {}) {
    const budget = opts.rounds || 4000;
    let actions = 0;
    let rounds = 0;

    for (; rounds < budget; rounds++) {
      const cons = this.constraints(board, st);
      const safe = new Set(), mines = new Set();

      this.ruleCount(cons, safe, mines);
      if (!safe.size && !mines.size) this.ruleSubset(cons, safe, mines);
      if (!safe.size && !mines.size) this.ruleTotal(board, st, safe, mines);
      if (!safe.size && !mines.size && !opts.noEnum) this.ruleEnumerate(board, st, cons, safe, mines);
      if (!safe.size && !mines.size) break;

      for (const i of mines) if (this.mark(board, st, i)) actions++;
      for (const i of safe) {
        if (st.rev[i] || st.mk[i]) continue;
        if (this.reveal(board, st, i) < 0) return { won: false, unsound: i, actions, rounds };
        actions++;
      }
    }

    return { won: this.won(board, st), stuck: !this.won(board, st), actions, rounds };
  },

  // Deal the opening dig, then reason. The whole no-guess guarantee is
  // `solve(...).won === true`.
  solve(board, opening, opts = {}) {
    const st = this.newState(board);
    if (this.reveal(board, st, opening) < 0) return { won: false, actions: 0, state: st };
    const r = this.run(board, st, opts);
    return { ...r, actions: r.actions + 1, state: st };
  },

  // What a canary can be sent to: a cell the player could already have proved
  // safe from what is on screen. Used for the hint, so a canary never reveals
  // anything the player was not entitled to work out — and never guesses.
  provableSafe(board, view) {
    const st = { rev: Uint8Array.from(view.rev), mk: Uint8Array.from(view.mk), revealed: 0, marked: 0 };
    for (let i = 0; i < board.n; i++) { if (st.rev[i]) st.revealed++; if (st.mk[i]) st.marked++; }

    const cons = this.constraints(board, st);
    const safe = new Set(), mines = new Set();
    this.ruleCount(cons, safe, mines);
    if (!safe.size) this.ruleSubset(cons, safe, mines);
    if (!safe.size) this.ruleTotal(board, st, safe, mines);
    if (!safe.size) this.ruleEnumerate(board, st, cons, safe, mines);

    // A player's own flags can be wrong, and a deduction built on a wrong flag
    // is worthless — so anything the rules offer is checked against the board
    // before the canary is sent. Falling back to any genuinely safe unknown
    // cell keeps the promise "a canary always finds clean air".
    for (const i of safe) if (!board.mine[i] && !st.rev[i]) return i;
    const spare = [];
    for (let i = 0; i < board.n; i++) if (!st.rev[i] && !st.mk[i] && !board.mine[i]) spare.push(i);
    return spare.length ? spare[0] : -1;
  },
};

if (typeof window === "undefined") Object.assign(globalThis, { Solver });
