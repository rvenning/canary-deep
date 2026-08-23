// App shell — splash, roster, the seam map, free play, the Daily Seam, results
// and the family leaderboard. Profiles, PINs, sync and install all come from
// gamekit; this file only decides what goes on each screen.

const AVATARS = ["🐤", "⛏️", "🔦", "🦊", "🐱", "🦉", "🐼", "🐸", "🦇", "🐀", "🐝", "🦅"];

const App = {
  profile: null,

  el(id) { return document.getElementById(id); },

  init() {
    const settings = Storage.getSettings();
    Sfx.enabled = settings.sound !== false;

    GK.UI.onScreenChange = (name) => {
      Game.active = name === "game";
      if (name !== "game") Engine.stop();
      if (name === "splash") this.refreshSplash();
    };
    GK.UI.bindSoundToggle(Storage);
    // Every menu button clicks; buttons that make their own sound keep it.
    GK.UI.bindMenuClicks();

    GK.Profiles.init({
      storage: Storage,
      avatars: AVATARS,
      meta: (p, prog) =>
        `⭐ ${Storage.totalStars(prog)}/${SHIFTS.length * 3} · ⛏️ ${Storage.cleared(prog)}/${SHIFTS.length} · 📅 ${prog.dailyCleared || 0}`,
      onEnter: (p) => { this.profile = p; this.showMap(); },
      addLabel: "New Miner",
    });

    GK.initPWA({ appName: "Canary Deep" });
    Render.boot();

    GK.Debug.init({ storage: Storage, title: "CANARY DEEP" })
      .jump("shift", SHIFTS.length, (n) => this.startShift(n - 1))
      .action("solve it", () => {
        if (!Game.board || !Game.running()) return;
        const r = Solver.run(Game.board, { rev: Game.rev, mk: Game.mk, revealed: Game.revealed, marked: Game.marked });
        Game.revealed = 0;
        for (let i = 0; i < Game.n; i++) if (Game.rev[i]) Game.revealed++;
        Game.checkWin();
        return r;
      });

    this.showScreen("splash");
    Storage.initFirebase().then((ok) => {
      this.el("sync-badge").textContent = ok ? "☁️ family sync on" : "📴 offline";
      if (ok && GK.UI.screen === "profiles") GK.Profiles.renderList();
      if (ok && GK.UI.screen === "splash") this.refreshSplash();
      if (ok && GK.UI.screen === "map") this.showMap();
      if (ok && GK.UI.screen === "leaderboard") this.showLeaderboard(true);
    });
  },

  showScreen(name) { GK.UI.showScreen(name); },
  progress() { return Storage.getProgress(this.profile.id); },

  /* ------------------------------------------------------------- splash -- */

  refreshSplash() {
    const last = GK.Profiles.lastProfile();
    const cont = this.el("btn-continue-as"), start = this.el("btn-start");
    if (last) {
      cont.style.display = "";
      cont.textContent = `⛏️ Continue as ${last.avatar} ${last.name}`;
      cont.onclick = () => { Sfx.init(); GK.Profiles.select(last); };
      start.className = "btn ghost";
      start.textContent = "👥 Switch Miner";
    } else {
      cont.style.display = "none";
      start.className = "btn big green";
      start.textContent = "⛏️ Go Down";
    }
  },

  play() {
    Sfx.init(); Sfx.click();
    GK.Profiles.renderList();
    this.showScreen("profiles");
  },

  howTo() { Sfx.click(); GK.UI.openModal("modal-howto"); },

  /* ---------------------------------------------------------------- map -- */

  showMap() {
    if (!this.profile) return this.play();
    const prog = this.progress();
    const unlocked = Storage.unlocked(prog);

    this.el("map-player").innerHTML = `${this.profile.avatar} <b>${GK.util.esc(this.profile.name)}</b>`;
    this.el("map-stars").textContent = `⭐ ${Storage.totalStars(prog)}`;

    const cont = this.el("btn-continue");
    const done = Storage.campaignDone(prog);
    cont.textContent = done ? `⛏️ ${SHIFTS[unlocked].name} again` : `⛏️ ${SHIFTS[unlocked].name}`;
    cont.onclick = () => this.startShift(unlocked);

    const today = RNG.today();
    const mine = Storage.dailyFor(prog, today);
    this.el("btn-daily").textContent = mine ? "📅 Daily ✓" : "📅 Daily Seam";

    this.el("seam-list").innerHTML = SEAMS.map((seam, si) => {
      const items = SHIFTS.map((s, i) => ({ s, i })).filter((e) => e.s.seam === si);
      const cells = items.map(({ s, i }) => {
        const rec = prog.shifts && prog.shifts[i];
        const open = i <= unlocked;
        const stars = rec ? rec.stars : 0;
        return `<button class="shift${open ? "" : " locked"}${i === unlocked && !done ? " next" : ""}"
          ${open ? `onclick="App.startShift(${i})"` : "disabled"}
          aria-label="${open ? `Shift ${i + 1}, ${GK.util.esc(s.name)}, ${stars} of 3 stars` : `Shift ${i + 1}, locked`}">
          <span class="sh-n">${open ? i + 1 : "🔒"}</span>
          <span class="sh-name">${open ? GK.util.esc(s.name) : "???"}</span>
          <span class="sh-size">${open ? `${s.cols}×${s.rows} · ${s.mines}💣` : ""}</span>
          <span class="sh-stars">${open ? "★".repeat(stars) + "☆".repeat(3 - stars) : ""}</span>
        </button>`;
      }).join("");
      return `<section class="seam" style="--sc:${seam.edge}">
        <h3>${seam.icon} ${GK.util.esc(seam.name)}</h3>
        <p class="seam-blurb">${GK.util.esc(seam.blurb)}</p>
        <div class="shift-grid">${cells}</div>
      </section>`;
    }).join("");

    this.showScreen("map");
  },

  /* --------------------------------------------------------------- play -- */

  enterGame(title, hint) {
    this.el("hud-title").textContent = title;
    this.el("game-hint").textContent = hint || "";
    this.el("game-hint").style.display = hint ? "" : "none";
    Render.revealAll = false;
    this.showScreen("game");
    // The stage measures 0x0 while the screen is hidden, so this has to run
    // after showScreen, not before it.
    Render.resize();
    Engine.start();
  },

  startShift(idx) {
    Sfx.init(); Sfx.click();
    const s = SHIFTS[idx];
    Game.start({ mode: "shift", shiftIdx: idx, cols: s.cols, rows: s.rows, mines: s.mines, canaries: s.canaries });
    this.enterGame(`${idx + 1}. ${s.name}`, s.hint);
  },

  showFree() {
    Sfx.click();
    const prog = this.progress();
    this.el("size-list").innerHTML = SIZES.map((z) => {
      const rec = (prog.free && prog.free[z.id]) || {};
      const pct = ((z.mines / (z.cols * z.rows)) * 100).toFixed(0);
      return `<button class="size-card" onclick="App.startFree('${z.id}')"
        aria-label="${GK.util.esc(z.name)}, ${z.cols} by ${z.rows}, ${z.mines} mines">
        <span class="size-icon">${z.icon}</span>
        <span class="size-info">
          <span class="size-name">${GK.util.esc(z.name)}</span>
          <span class="size-meta">${z.cols}×${z.rows} · ${z.mines}💣 · ${pct}% gas</span>
        </span>
        <span class="size-best">${rec.best ? `⏱ ${Render.time(rec.best)}` : "—"}<small>${rec.wins || 0}/${rec.plays || 0}</small></span>
      </button>`;
    }).join("");
    this.showScreen("free");
  },

  startFree(id) {
    Sfx.init(); Sfx.click();
    const z = SIZES.find((x) => x.id === id);
    Game.start({ mode: "free", sizeId: id, cols: z.cols, rows: z.rows, mines: z.mines, canaries: z.canaries });
    this.enterGame(`${z.icon} ${z.name}`, "");
  },

  /* --------------------------------------------------------- daily seam -- */

  showDaily() {
    Sfx.click();
    const date = RNG.today();
    const prog = this.progress();
    const mine = Storage.dailyFor(prog, date);
    this.el("daily-date").textContent = date;

    this.el("daily-body").innerHTML = mine
      ? `<div class="daily-card">
           <span class="daily-big">${mine.cleared ? Render.time(mine.time) : "💥"}</span>
           <span class="size-meta">${mine.cleared
             ? `cleared today · ${"★".repeat(mine.stars)}${"☆".repeat(3 - mine.stars)}`
             : "the gas got you today"}</span>
           <span class="size-meta">One attempt a day. Come back tomorrow for a fresh seam.</span>
         </div>`
      : `<div class="daily-card">
           <span class="daily-big">📅</span>
           <span class="size-meta">${DAILY.cols}×${DAILY.rows} · ${DAILY.mines}💣 — the same board for everybody today.</span>
           <span class="size-meta"><b>You get one attempt.</b> The first square is already dug, so the clock starts on your move.</span>
           <button class="btn green wide" onclick="App.startDaily()">📅 Take today's shift</button>
         </div>`;

    const rows = Storage.dailyBoard(date);
    this.el("daily-rows").innerHTML = rows.length
      ? rows.map((r, i) => `<div class="lb-row${r.profile.id === this.profile.id ? " me" : ""}">
          <span class="lb-rank">${r.entry.cleared ? i + 1 : "—"}</span>
          <span class="lb-avatar">${r.profile.avatar}</span>
          <span class="lb-name">${GK.util.esc(r.profile.name)}</span>
          <span class="lb-stat">${r.entry.cleared ? `⏱ ${Render.time(r.entry.time)}` : "💥"}</span>
          <span class="lb-stat">${r.entry.cleared ? "★".repeat(r.entry.stars) : ""}</span>
        </div>`).join("")
      : `<p class="nudge">Nobody has been down today. Be first.</p>`;

    this.showScreen("daily");
  },

  startDaily() {
    const date = RNG.today();
    if (Storage.dailyFor(this.progress(), date)) { GK.UI.toast("You have had your attempt today"); return; }
    Sfx.init(); Sfx.click();
    const seed = RNG.seedFrom("canary-deep|" + date);
    // The opening square is part of the seed, because a shared board is only
    // genuinely shared if everyone starts from the same hole.
    const opening = RNG.sub(seed, "opening").int(0, DAILY.cols * DAILY.rows - 1);
    Game.start({
      mode: "daily", date, seed, opening,
      cols: DAILY.cols, rows: DAILY.rows, mines: DAILY.mines, canaries: DAILY.canaries,
    });
    this.enterGame(`📅 ${date}`, "One attempt. Same board as everyone else.");
  },

  /* ------------------------------------------------------------ in-game -- */

  // Set, not toggle: the switch shows both modes, so each half means "be this"
  // rather than "swap".
  setFlagMode(on) {
    Game.flagMode = !!on;
    Sfx.click();
    Render.hud();
    // Nothing exists to flag until the seam is cut, and it is cut around the
    // opening tap — so say so rather than letting the next tap do nothing.
    if (Game.flagMode && Game.state === "ready") GK.UI.toast("Dig first — the seam is cut around your opening tap");
  },

  canary() {
    if (!Game.sendCanary()) { GK.UI.toast(Game.canaries <= 0 ? "The cage is empty" : "Dig somewhere first"); Sfx.wrong(); }
  },

  pause() {
    if (!Game.running()) return;
    Game.paused = true;
    Sfx.click();
    GK.UI.openModal("modal-pause");
  },

  resume() { Game.paused = false; GK.UI.closeModal("modal-pause"); Sfx.click(); },

  restart() {
    GK.UI.closeModal("modal-pause");
    Game.paused = false;
    if (Game.mode === "daily") { GK.UI.toast("The Daily Seam is one attempt only"); return; }
    if (Game.mode === "free") this.startFree(Game.sizeId);
    else this.startShift(Game.shiftIdx);
  },

  quitShift() {
    GK.UI.closeModal("modal-pause");
    Game.paused = false;
    Game.quit();
  },

  /* ------------------------------------------------------------ results -- */

  shiftOver(res) {
    if (!res) { Engine.stop(); this.showMap(); return; }

    // The board stays on screen behind the sheet for a moment so the last
    // reveal is actually seen, rather than being replaced by a results card.
    setTimeout(() => this.showResults(res), res.cleared ? 900 : 1100);
  },

  showResults(res) {
    Engine.stop();
    let prog;
    if (res.mode === "shift") prog = Storage.recordShift(this.profile.id, res);
    else if (res.mode === "free") prog = Storage.recordFree(this.profile.id, res);
    else prog = Storage.recordDaily(this.profile.id, res);

    this.el("res-emoji").textContent = res.cleared ? (res.stars === 3 ? "🏆" : "🐤") : "💥";
    this.el("res-title").textContent = res.cleared ? "Seam cleared" : "The gas got you";
    this.el("res-stars").textContent = res.mode === "shift"
      ? "★".repeat(res.stars) + "☆".repeat(3 - res.stars) : "";
    this.el("res-score").textContent = res.cleared ? Render.time(res.time) : `${res.dug} squares dug`;

    const bits = [`🎯 par ${Render.time(res.par)}`, `🐤 ${res.canariesLeft}/${res.canariesStart} left`];
    if (res.penalty) bits.push(`⏱ +${res.penalty}s canary`);
    bits.push(`💣 ${res.mines} in ${res.cols}×${res.rows}`);
    this.el("res-stats").innerHTML = bits.map((b) => `<div>${b}</div>`).join("");

    const note = this.el("res-note");
    const retry = this.el("res-retry"), next = this.el("res-next");
    retry.style.display = "none"; next.style.display = "none";
    this.el("res-finished").style.display = "none";

    if (!res.cleared) {
      note.textContent = "Every board here can be solved without guessing — so that one could have been worked out. Have another go.";
    } else if (res.mode === "shift" && res.stars < 3) {
      note.textContent = res.stars === 1
        ? `Out alive. Beat par (${Render.time(res.par)}) for the second star.`
        : "Two stars. Do it again without spending a bird for the third.";
    } else if (res.cleared) {
      note.textContent = res.mode === "daily"
        ? "That is your attempt for today. See how the family got on."
        : "Clean work — par beaten with the cage still full.";
    }

    if (res.mode === "shift") {
      retry.style.display = "";
      retry.textContent = "↻ Same shift";
      retry.onclick = () => this.startShift(res.shiftIdx);
      const nextIdx = res.shiftIdx + 1;
      if (res.cleared && nextIdx < SHIFTS.length) {
        next.style.display = "";
        next.textContent = `▶️ ${SHIFTS[nextIdx].name}`;
        next.onclick = () => this.startShift(nextIdx);
      }
      if (res.cleared && nextIdx >= SHIFTS.length) this.el("res-finished").style.display = "";
      for (let i = 0; i < res.stars; i++) setTimeout(() => Sfx.star(i + 1), 320 + i * 240);
    } else if (res.mode === "free") {
      const rec = (prog.free && prog.free[res.sizeId]) || {};
      if (res.cleared && rec.best === res.time) { note.textContent = "A new best for this size."; setTimeout(() => Sfx.newBest(), 300); }
      retry.style.display = "";
      retry.textContent = "↻ New board";
      retry.onclick = () => this.startFree(res.sizeId);
    } else {
      next.style.display = "";
      next.textContent = "📅 Today's standings";
      next.onclick = () => this.showDaily();
    }

    this.showScreen("results");
  },

  /* -------------------------------------------------------- leaderboard -- */

  showLeaderboard(silent) {
    if (!silent) Sfx.click();
    GK.Profiles.renderLeaderboard("lb-rows", {
      cols: (r) => `<span class="lb-stat">⭐ ${Storage.totalStars(r.progress)}</span>
        <span class="lb-stat">📅 ${r.progress.dailyCleared || 0}</span>`,
      sort: (a, b) => Storage.totalStars(b.progress) - Storage.totalStars(a.progress)
        || (b.progress.dailyCleared || 0) - (a.progress.dailyCleared || 0),
      meId: this.profile?.id,
      empty: "Nobody down the pit yet — tap Go Down!",
    });
    this.showScreen("leaderboard");
  },
};

// Pinch zoom sticks forever on iOS once it happens, and there is no way to
// reset it from script — so it has to be blocked at the source.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());

// Run init on DOMContentLoaded rather than inline at the bottom of <body>:
// rendering the first screen before layout settles resolves viewport-relative
// clamp() font sizes against the inherited value on that one render.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => App.init());
else App.init();