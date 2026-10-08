/* Daily Routine Tracker. Habits are never ticked by hand: each one is worked out from what you log
 * (tasks done, meals eaten, water, workouts, bed and wake times). Plan content lives in data/*.json. */
(async function () {
  const $ = id => document.getElementById(id);
  const VIEWS = ["today", "workout", "progress", "guide"];
  const FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

  /* ---------- app lock: nothing below runs (or even loads) until the passcode is entered ---------- */
  if (window.Auth) await Auth.gate();

  /* ---------- small per-device preferences ---------- */
  const pref = {
    get(k, d) { try { const v = localStorage.getItem("routine-" + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("routine-" + k, v); } catch (e) {} },
  };
  function applyTheme() {
    const t = pref.get("theme", "auto"), root = document.documentElement;
    if (t === "light" || t === "dark") root.dataset.theme = t; else delete root.dataset.theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
      const dark = t === "dark" || (t === "auto" && (m.getAttribute("media") || "").includes("dark"));
      m.setAttribute("content", dark ? "#13181C" : "#F6F4EF");
    });
  }
  applyTheme();

  /* ---------- load plan data ---------- */
  let PLAN, SESS, FIGS;
  try {
    const get = p => fetch(p, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
    [PLAN, SESS, FIGS] = await Promise.all([get("data/plan.json"), get("data/workouts.json"), get("data/figures.json")]);
  } catch (e) {
    $("p-today").innerHTML = '<div class="empty">Couldn\'t load the plan files in <code>data/</code>. If you opened index.html straight from your disk, run a local server instead (see README), or open the deployed site.</div>';
    return;
  }
  const DAYS = PLAN.days, R = PLAN.rules, NH = PLAN.habits.length;

  /* ---------- dates & time ---------- */
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = s => new Date(s + "T12:00:00");
  const dow = d => (d.getDay() + 6) % 7;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayStr = () => ymd(new Date());
  const dayOf = date => DAYS[dow(parse(date))];
  const mins = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
  const hhmm = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
  const fmt = t => { let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + ":" + pad(m) + " " + ap; };
  const fmtShort = t => { let [h, m] = t.split(":").map(Number); h = h % 12 || 12; return h + ":" + pad(m); };
  const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

  /* ---------- state ---------- */
  const store = await Store.open();
  let records = store.records();
  let selDate = todayStr(), tab = "today", editing = null;
  let fresh = null, enter = true;      // fresh: the task just done (gets a pop); enter: the next render slides the panel in
  const fold = {}, shown = {};           // fold: which collapsible cards are open; shown: last value drawn, so bars and the ring fill up from there
  const blank = () => ({ v: 2, mode: null, tasks: {}, meals: {}, sessions: {}, water: 0, slips: 0, checkin: {}, note: "", lifts: {} });
  const rec = date => { const r = records[date]; return r ? { ...blank(), ...r, tasks: { ...(r.tasks || {}) }, meals: { ...(r.meals || {}) }, sessions: { ...(r.sessions || {}) }, checkin: { ...(r.checkin || {}) }, lifts: { ...(r.lifts || {}) } } : blank(); };
  const modeFor = date => (records[date] && records[date].mode) || (PLAN.officeDefault.includes(dayOf(date)) ? "office" : "wfh");

  /* ---------- habit rules (all automatic) ---------- */
  const mealsFor = date => PLAN.meals[dayOf(date)];
  const eaten = date => { const r = rec(date), m = mealsFor(date); return Object.keys(m).filter(k => r.meals[k]).map(k => m[k]); };
  const protein = date => eaten(date).reduce((s, m) => s + m.protein, 0);
  const fv = date => eaten(date).reduce((s, m) => s + m.fv, 0);
  const active = r => Object.keys(r.tasks).length || Object.values(r.meals).some(Boolean) || r.water || Object.values(r.sessions).some(Boolean);
  function sleepMinutes(date) {
    const bed = rec(ymd(addDays(parse(date), -1))).tasks.sleep, wake = rec(date).tasks.wake;
    if (!bed || !wake) return null;
    const b = mins(bed), w = mins(wake);
    return b >= 12 * 60 ? (1440 - b) + w : w - b;
  }
  const hm = m => Math.floor(m / 60) + " h " + pad(m % 60) + " min";

  function habits(date) {
    const r = rec(date), out = {};
    const isToday = date === todayStr(), future = date > todayStr();
    const sl = sleepMinutes(date);
    out.sleep = sl == null ? [false, "Tap Lights out at night and Wake up in the morning"] : [sl >= R.sleepMinHours * 60, "Slept " + hm(sl)];
    out.sun = [!!r.tasks.wake, r.tasks.wake ? "Up at " + fmt(r.tasks.wake) : "Tap Wake up when you get up"];
    out.am = [!!r.sessions.am, r.sessions.am ? "Done" : PLAN.am[dayOf(date)]];
    out.pm = !SESS[dayOf(date)].pm ? [true, "Rest day, nothing to do"] : [!!r.sessions.pm, r.sessions.pm ? "Done" : PLAN.pm[dayOf(date)]];
    const p = protein(date); out.protein = [p >= R.proteinTarget, p + " / " + R.proteinTarget + " g from meals"];
    out.water = [r.water >= R.waterGlasses, (r.water * R.glassMl / 1000) + " / " + (R.waterGlasses * R.glassMl / 1000) + " L logged"];
    const curd = eaten(date).some(m => m.curd); out.curd = [curd, curd ? "From a meal with curd" : "Comes with lunch"];
    const f = fv(date); out.fv = [f >= R.fvTarget, f + " / " + R.fvTarget + " servings from meals"];
    const w = (r.tasks.walk1 ? 1 : 0) + (r.tasks.walk2 ? 1 : 0); out.walks = [w === 2, w + " / 2 walks"];
    const s = (r.tasks.skinam ? 1 : 0) + (r.tasks.skinpm ? 1 : 0); out.skin = [s === 2, s + " / 2 done"];
    const sc = r.tasks.screens; out.screens = [!!sc && mins(sc) <= mins(R.screensBy) && mins(sc) >= 17 * 60, sc ? "Screens off at " + fmt(sc) + (mins(sc) > mins(R.screensBy) ? " (late)" : "") : "Tap Screens off tonight"];
    let nj;
    if (r.slips > 0) nj = [false, r.slips + " slip" + (r.slips > 1 ? "s" : "") + " logged"];
    else if (future) nj = [null, "Counts at 9 pm"];
    else if (isToday && nowMin() < mins(R.nojunkAfter)) nj = [null, "On track, counts at 9 pm"];
    else if (!active(r)) nj = [false, "Nothing logged that day"];
    else nj = [true, "No slips logged"];
    out.nojunk = nj;
    const blocks = timeline(date).filter(it => it.career), doneB = blocks.filter(it => r.tasks[it.id]);
    out.career = [doneB.length > 0, doneB.length ? doneB.map(it => it.label.replace(/ \(.*\)/, "")).join(", ") : (blocks.length ? "Today: " + blocks.map(it => fmtShort(it.t) + " " + it.label.replace(/ \(.*\)/, "")).join(" · ") : "No block planned today")];
    // records from the first version had hand-ticked habits; keep honouring those
    if (records[date] && !records[date].v && records[date].habits) {
      PLAN.habits.forEach(([, , rule], i) => { if (records[date].habits["h" + i] && out[rule][0] !== true) out[rule] = [true, "Ticked earlier"]; });
    }
    return out;
  }
  const doneCount = date => { const h = habits(date); return PLAN.habits.filter(([, , rule]) => h[rule][0] === true).length; };

  /* ---------- timeline ---------- */
  function timeline(date) {
    const off = modeFor(date) === "office", day = dayOf(date), m = mealsFor(date);
    return PLAN.timeline.map(([id, w, o, label, detail, kind, days, career]) => {
      const t = off ? o : w; if (!t) return null;
      if (days && !days.includes(day)) return null;
      if (id === "pm" && !SESS[day].pm) return null;
      let d = detail, lab = label;
      if (kind === "meal") d = m[id].text;
      if (id === "am") { d = PLAN.am[day]; if (off) lab = "Morning session (35-40 min)"; }
      if (id === "pm") d = PLAN.pm[day];
      if (id === "prewo" && day === "Sun") lab = "Afternoon snack";
      return { id, t, label: lab, d, kind, career: !!career, meal: kind === "meal" ? m[id] : null };
    }).filter(Boolean);
  }
  const isDoneItem = (r, it) => it.kind === "meal" ? !!r.meals[it.id] : it.kind === "session" ? !!r.sessions[it.id] : !!r.tasks[it.id];

  /* ---------- helpers ---------- */
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
    return e;
  }
  const svg = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
  const buzz = (pattern = 12) => { try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) {} };
  const calm = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // set a bar or ring to `to` (0 to 1): draw it at the last value, then move it so the CSS transition plays
  function fill(key, to, draw) {
    const from = key in shown ? shown[key] : 0; shown[key] = to; draw(from);
    if (from !== to) requestAnimationFrame(() => requestAnimationFrame(() => draw(to)));
  }
  // confetti burst from the middle of the screen; skipped when the phone asks for less motion
  function confetti(n) {
    if (calm() || !document.body.animate) return;
    const box = el("div", { class: "confetti", "aria-hidden": "true" }), cs = getComputedStyle(document.documentElement);
    const colors = ["--accent", "--food", "--am", "--pm", "--care"].map(v => cs.getPropertyValue(v).trim());
    document.body.append(box);
    for (let i = 0; i < n; i++) {
      const p = el("i", { style: `background:${colors[i % colors.length]};left:50%;top:42%;width:${6 + Math.random() * 6}px;height:${9 + Math.random() * 8}px` });
      const ang = (-20 - Math.random() * 140) * Math.PI / 180, sp = 180 + Math.random() * 320;
      const dx = Math.cos(ang) * sp, dy = Math.sin(ang) * sp, fall = 380 + Math.random() * 260, rot = (Math.random() - .5) * 900;
      box.append(p);
      p.animate([
        { transform: "translate(0,0) rotate(0) scale(.5)", opacity: 1 },
        { transform: `translate(${dx * .65}px,${dy}px) rotate(${rot / 2}deg) scale(1)`, opacity: 1, offset: .4 },
        { transform: `translate(${dx}px,${dy + fall}px) rotate(${rot}deg) scale(.9)`, opacity: 0 }
      ], { duration: 1300 + Math.random() * 800, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
    }
    setTimeout(() => box.remove(), 2400);
  }
  let toastT;
  // with an undo function the toast stays longer and carries an Undo button
  function toast(msg, undo) {
    const t = $("toast"); t.replaceChildren(msg);
    if (undo) t.append(el("button", { type: "button", onclick: () => { clearTimeout(toastT); t.hidden = true; undo(); } }, "Undo"));
    t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), undo ? 5000 : 2400);
  }
  const setStatus = s => ($("status").textContent = s);

  /* ---------- saving ---------- */
  const dirty = new Set(), timers = {};
  let chain = Promise.resolve();
  // opts.msg: say what changed and offer Undo. opts.silent: typing, so skip the re-render and batch the save
  function update(date, fn, opts = {}) {
    const before = doneCount(date), prev = records[date];
    const r = rec(date); if (!r.mode) r.mode = modeFor(date);
    fn(r); r.v = 2; r.updatedAt = new Date().toISOString();
    records[date] = r; dirty.add(date);
    clearTimeout(timers[date]); if (store.kind === "local" && !opts.silent) flush(date); else timers[date] = setTimeout(() => flush(date), 400);
    if (!opts.silent) render();
    const after = doneCount(date);
    let note = opts.msg || "";
    if (after === NH && before < NH) { note += (note ? " · " : "") + "Perfect day. All " + NH + " habits done"; confetti(90); buzz([30, 40, 30, 40, 90]); }
    else if (after >= R.goodDay && before < R.goodDay) { note += (note ? " · " : "") + "Good day: " + after + " / " + NH + " habits"; confetti(42); buzz([30, 40, 60]); }
    if (note) toast(note, opts.msg ? () => undoTo(date, prev) : null);
  }
  // put a day back the way it was; stamped as new so it also wins when merged with other devices
  function undoTo(date, prev) {
    const r = prev ? JSON.parse(JSON.stringify(prev)) : blank();
    r.updatedAt = new Date().toISOString();
    records[date] = r; dirty.add(date); flush(date); render();
  }
  function flush(date) {
    chain = chain.then(async () => {
      try { await store.save(date, records[date]); setStatus(store.label); }
      catch (e) { setStatus(store.label); }
      dirty.delete(date);
    });
  }
  const flushAll = () => { for (const d of [...dirty]) { clearTimeout(timers[d]); flush(d); } };
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); });
  store.subscribe(next => {
    for (const d of dirty) if (records[d]) next[d] = records[d];
    records = next; render();
  });
  setStatus(store.label);

  // tap a task: records the time you did it (planned time when logging another day)
  function toggleTask(date, it) {
    buzz();
    const r = rec(date);
    if (it.kind === "meal") { if (!r.meals[it.id]) fresh = it.id; return update(date, x => { x.meals[it.id] = !r.meals[it.id]; }, { msg: it.label + (r.meals[it.id] ? " unmarked" : " eaten") }); }
    if (it.kind === "session") { if (!r.sessions[it.id]) fresh = it.id; return update(date, x => { x.sessions[it.id] = !r.sessions[it.id]; }, { msg: it.label + (r.sessions[it.id] ? " unmarked" : " done") }); }
    if (r.tasks[it.id]) { editing = editing === date + it.id ? null : date + it.id; return render(); }
    fresh = it.id;
    let target = date, time = date === todayStr() ? hhmm(new Date()) : it.t;
    // Lights out tapped just after midnight belongs to the night before
    if (it.id === "sleep" && date === todayStr() && nowMin() < 4 * 60) target = ymd(addDays(new Date(), -1));
    update(target, x => { x.tasks[it.id] = time; }, { msg: it.label + " at " + fmt(time) });
  }

  /* ---------- header ---------- */
  function renderHeader() {
    const d = parse(selDate), isToday = selDate === todayStr();
    $("dayTitle").textContent = FULL[dayOf(selDate)];
    $("dateLabel").textContent = (isToday ? "Today · " : "") + d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    $("backToday").hidden = isToday;
    const mode = modeFor(selDate);
    $("modeWfh").setAttribute("aria-pressed", String(mode === "wfh"));
    $("modeOffice").setAttribute("aria-pressed", String(mode === "office"));
    const show = tab === "today" || tab === "workout";
    $("days").hidden = !show; $("modeSeg").hidden = !show;
    $("prevDay").hidden = $("nextDay").hidden = !show;
    $("dateLabel").parentElement.classList.toggle("has-nav", show);
    $("nextDay").disabled = selDate >= ymd(addDays(new Date(), 7));
    $("lockNow").hidden = !(window.Auth && Auth.enabled());
    const box = $("days"); box.replaceChildren();
    const ws = addDays(d, -dow(d));
    for (let i = 0; i < 7; i++) {
      const dt = ymd(addDays(ws, i)), c = doneCount(dt);
      const lvl = c === 0 ? 0 : c >= NH ? 4 : c >= R.goodDay ? 3 : c >= 6 ? 2 : 1;
      box.append(el("button", { "aria-pressed": String(dt === selDate), class: dt === todayStr() ? "today" : null, "aria-label": FULL[DAYS[i]] + ", " + c + " of " + NH + " habits", onclick: () => { selDate = dt; editing = null; enter = true; render(); } },
        el("small", {}, DAYS[i]), el("b", { class: "num" }, String(addDays(ws, i).getDate())), el("span", { class: "dot", style: lvl ? `background:var(--heat${lvl})` : null })));
    }
  }

  /* ---------- TODAY ---------- */
  function actionButton(date, it, r, big) {
    const done = isDoneItem(r, it);
    if (it.kind === "info") return null;
    if (it.kind === "meal") return el("button", { class: big ? "go" : "act meal", "aria-pressed": String(done), onclick: () => toggleTask(date, it) }, done ? "✓ Eaten" : (big ? "Mark eaten" : "Eat"), big ? null : el("span", { class: "g" }, it.meal.protein + "g"));
    if (it.kind === "session") return el("button", { class: big ? "go" : "act", "aria-pressed": String(done), onclick: () => toggleTask(date, it) }, done ? "✓ Done" : "Done");
    const t = r.tasks[it.id];
    return el("button", { class: big ? "go" : "act", "aria-pressed": String(!!t), "aria-label": t ? it.label + " done at " + fmt(t) + ", tap to edit" : "Mark " + it.label + " done", onclick: () => toggleTask(date, it) }, t ? "✓ " + fmtShort(t) : "Done");
  }
  function editor(date, it, r) {
    const inp = el("input", { type: "time", value: r.tasks[it.id], "aria-label": "Time for " + it.label });
    return el("div", { class: "editor" }, el("span", {}, "Done at"), inp,
      el("button", { class: "act", onclick: () => { if (inp.value) update(date, x => { x.tasks[it.id] = inp.value; }); editing = null; render(); } }, "Save"),
      el("button", { class: "act ghost", onclick: () => { editing = null; update(date, x => { delete x.tasks[it.id]; }, { msg: it.label + " removed" }); } }, "Remove"));
  }

  function renderToday() {
    const p = $("p-today"); p.replaceChildren();
    const date = selDate, r = rec(date), tl = timeline(date), isToday = date === todayStr(), H = habits(date);

    // backup reminder (browser storage only)
    if (store.kind === "local" && Object.keys(records).length >= 3) {
      const lb = store.meta().lastBackup, days = lb ? Math.floor((Date.now() - new Date(lb)) / 864e5) : null;
      if (days === null || days >= 7) p.append(el("div", { class: "banner" },
        el("div", {}, el("b", {}, days === null ? "Back up your data" : "Last backup " + days + " days ago"), el("div", { class: "muted" }, "Your log lives in this browser. Export a .json copy so you don't lose it.")),
        el("button", { class: "go", onclick: exportData }, "Export")));
    }

    // first-run welcome (goes away once you log something or tap Got it)
    if (!Object.keys(records).length && !pref.get("welcome", "")) p.append(el("div", { class: "banner" },
      el("div", {}, el("b", {}, "Welcome. Here's how this works"),
        el("ul", { class: "plain small" },
          el("li", {}, "Tap a task in the day plan when you do it. The time is saved for you."),
          el("li", {}, "Habits fill in by themselves from what you log. Nothing to tick."),
          el("li", {}, "Your log stays in this browser. Export a backup now and then from Guide."))),
      el("button", { class: "go", onclick: () => { pref.set("welcome", "1"); render(); } }, "Got it")));

    // now / next
    if (isToday) {
      const nm = nowMin(); let ci = -1; tl.forEach((it, i) => { if (mins(it.t) <= nm) ci = i; });
      // first thing not yet done at or before now = what to do
      let cur = ci >= 0 ? tl[ci] : null;
      const pending = tl.slice(0, ci + 1).filter(it => it.kind !== "info" && !isDoneItem(r, it));
      const focus = pending.length ? pending[pending.length - 1] : cur;
      const nxt = tl[ci + 1] || null;
      const box = el("div", { class: "now" + (fresh ? " swap" : "") });
      if (!focus) box.append(el("div", {}, el("div", { class: "eyebrow" }, "Before your day starts"), el("div", { class: "what" }, "Rest up"), el("div", { class: "sub" }, "Day starts at " + fmt(tl[0].t))));
      else {
        const late = focus !== cur;
        box.append(el("div", {}, el("div", { class: "eyebrow" }, (late ? "Still to do · " : "Now · ") + fmt(focus.t)), el("div", { class: "what" }, focus.label), el("div", { class: "sub" }, focus.d || "")));
        const acts = el("div", { class: "nowacts" });
        if (focus.kind === "session") acts.append(el("button", { class: "go ghost", onclick: () => go("workout") }, "Open workout"));
        const b = actionButton(date, focus, r, true); if (b) acts.append(b);
        box.append(acts);
        if (pending.length > 1) box.append(el("div", { class: "sub", style: "grid-column:1/-1" }, (pending.length - 1) + " earlier item" + (pending.length > 2 ? "s" : "") + " not logged yet, see the day plan"));
      }
      if (nxt) { const left = mins(nxt.t) - nm; box.append(el("div", { class: "next" }, el("span", { class: "eyebrow" }, "Next in " + (left >= 60 ? Math.floor(left / 60) + " h " + (left % 60) + " min" : left + " min")), el("b", {}, fmt(nxt.t) + " · " + nxt.label))); }
      p.append(box);
    }

    // score for the day, with the streak it feeds (the flame lights up once today counts)
    const dc = doneCount(date), prot = protein(date), nj = H.nojunk, st = streaks(), good = dc >= R.goodDay;
    const ring = svg(`<svg class="ring${dc === NH ? " done" : ""}" viewBox="0 0 60 60" aria-hidden="true"><circle class="track" cx="30" cy="30" r="24"/><circle class="val" cx="30" cy="30" r="24" transform="rotate(-90 30 30)" stroke-dasharray="150.8"/><text class="rn" x="30" y="36" text-anchor="middle">${dc}</text></svg>`);
    const val = ring.querySelector(".val");
    fill("ring", dc / NH, v => { val.style.strokeDashoffset = 150.8 * (1 - v) + "px"; });
    const flame = svg('<svg class="flame" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.6 3.6 5 6 5 11a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.2 1.8 1 2.8 2 3C11.2 7.2 10.8 4.6 12 2z"/></svg>');
    p.append(el("div", { class: "hero" + (dc === NH ? " perfect" : good ? " good" : "") }, ring,
      el("div", { class: "heroTxt" }, el("div", { class: "big" }, dc === NH ? "Perfect day" : good ? "Good day" : dc ? "Keep going" : "Let's start"),
        el("div", { class: "muted small" }, dc + " of " + NH + " habits · " + (dc === NH ? "all done" : good ? (NH - dc) + " to perfect" : (R.goodDay - dc) + " to a good day"))),
      el("div", { class: "streak" + (good ? " lit" : ""), role: "img", "aria-label": st.cur + " day streak, best " + st.best }, flame, el("b", { class: "num" }, String(st.cur)), el("small", {}, "streak"))));

    const pbar = el("i"), wbar = el("i");
    fill("protein", Math.min(1, prot / R.proteinTarget), v => { pbar.style.width = v * 100 + "%"; });
    fill("water", Math.min(1, r.water / R.waterGlasses), v => { wbar.style.width = v * 100 + "%"; });
    p.append(el("div", { class: "stats" },
      el("div", { class: "stat" }, el("div", { class: "eyebrow" }, "Protein"),
        el("div", { class: "big num" }, String(prot), el("small", {}, " / " + R.proteinTarget + " g")),
        el("div", { class: "bar food" }, pbar),
        el("div", { class: "muted small" }, "Tap Eat on meals")),
      el("div", { class: "stat" }, el("div", { class: "eyebrow" }, "Water"),
        el("div", { class: "big num" }, String(r.water * R.glassMl / 1000), el("small", {}, " / " + (R.waterGlasses * R.glassMl / 1000) + " L")),
        el("div", { class: "bar water" }, wbar),
        el("div", { class: "pair" },
          el("button", { "aria-label": "Remove a glass", onclick: () => update(date, x => { x.water = Math.max(0, x.water - 1); }) }, "−"),
          el("button", { class: "plus", "aria-label": "Add a " + R.glassMl + " ml glass", onclick: () => { buzz(); update(date, x => { x.water = Math.min(20, x.water + 1); }); } }, "+ " + R.glassMl + " ml"))),
      el("div", { class: "stat" }, el("div", { class: "eyebrow" }, "Junk-free"),
        el("div", { class: "big" + (r.slips ? " warn" : "") }, r.slips ? r.slips + " slip" + (r.slips > 1 ? "s" : "") : nj[0] === true ? "Yes" : "On track"),
        el("div", { class: "muted small" }, "Sweets or packaged snacks? Log it."),
        el("div", { class: "pair" },
          el("button", { "aria-label": "Remove a slip", disabled: !r.slips || null, onclick: () => update(date, x => { x.slips = Math.max(0, x.slips - 1); }) }, "−"),
          el("button", { class: "slip", onclick: () => update(date, x => { x.slips = x.slips + 1; }, { msg: "Slip logged" }) }, "Log a slip")))
    ));

    // day plan (the main thing you interact with)
    const nm = nowMin(); let ci = -1; if (isToday) tl.forEach((it, i) => { if (mins(it.t) <= nm) ci = i; });
    const list = el("ol", { class: "tl" });
    // done items from earlier today fold into one line, so the list is about what's left (the one you just did stays put for its pop)
    const earlier = tl.map((it, i) => i < ci && it.kind !== "info" && it.id !== fresh && isDoneItem(r, it) ? i : -1).filter(i => i >= 0);
    const squash = earlier.length >= 2 && !fold.done;
    if (earlier.length >= 2 && fold.done) list.append(el("li", { class: "sumrow" }, el("button", { class: "linkish", onclick: () => { fold.done = false; render(); } }, "Hide the " + earlier.length + " done")));
    tl.forEach((it, i) => {
      if (squash && earlier.includes(i)) {
        if (i === earlier[0]) list.append(el("li", { class: "sumrow" }, el("button", { class: "linkish", onclick: () => { fold.done = true; render(); } }, "✓ " + earlier.length + " done earlier · Show")));
        return;
      }
      const done = isDoneItem(r, it);
      const cls = [it.kind === "meal" ? "food" : it.id === "am" ? "am" : it.id === "pm" ? "pm" : it.kind === "info" ? "info" : "care",
        done ? "done" : "", done && fresh === it.id ? "fresh" : "", isToday && i < ci && !done && it.kind !== "info" ? "missed" : "", i === ci ? "current" : ""].join(" ");
      const body = el("div", { class: "body" }, el("div", { class: "k" }, it.label), it.d ? el("div", { class: "d" }, it.d) : null,
        it.kind === "session" ? el("button", { class: "linkish", onclick: () => go("workout") }, "Open workout ›") : null);
      const li = el("li", { class: cls }, el("time", {}, fmtShort(it.t)), body, actionButton(date, it, r, false));
      list.append(li);
      if (editing === date + it.id && r.tasks[it.id]) list.append(el("li", { class: "editrow" }, editor(date, it, r)));
    });
    const doneItems = tl.filter(it => it.kind !== "info" && isDoneItem(r, it)).length, totalItems = tl.filter(it => it.kind !== "info").length;
    const planCard = el("div", { class: "card" }, el("div", { class: "cardhead" }, el("h2", {}, "Day plan"),
      el("span", { class: "muted small" }, doneItems + " / " + totalItems + " done · " + (modeFor(date) === "office" ? "office" : "WFH") + " times")), list);

    // habits (read-only, auto)
    const hl = el("ul", { class: "hlist" });
    PLAN.habits.forEach(([label, cat, rule, src]) => {
      const [ok, info] = H[rule];
      const state = ok === true ? "ok" : ok === null ? "pending" : "no";
      hl.append(el("li", { class: "h " + state },
        el("span", { class: "icon", "aria-hidden": "true" }, ok === true ? "✓" : ok === null ? "…" : ""),
        el("div", { class: "txt" }, el("div", { class: "lbl" }, label), el("div", { class: "hint" }, info)),
        el("span", { class: "tag" }, cat)));
    });
    p.append(planCard, foldCard("habits", "Habits", dc + " of " + NH + " · fills in by itself", hl, false));

    // check-in (opens by itself in the evening if you haven't filled it in)
    const ck = el("div", {});
    for (const [k, lab] of [["energy", "Energy"], ["sleep", "Sleep"], ["skin", "Skin"], ["gut", "Digestion"]]) {
      const row = el("div", { class: "scale", role: "group", "aria-label": lab }, el("span", {}, lab));
      for (let v = 1; v <= 5; v++) {
        const on = r.checkin[k] === v;
        row.append(el("button", { "aria-pressed": String(on), "aria-label": lab + " " + v + " of 5", onclick: () => { buzz(); update(date, x => { if (on) delete x.checkin[k]; else x.checkin[k] = v; }); } }, String(v)));
      }
      ck.append(row);
    }
    ck.append(el("div", { class: "scalekey" }, el("span", {}, "1 = poor"), el("span", {}, "5 = great")));
    const ta = el("textarea", { id: "note-" + date, placeholder: "Notes: breakouts, bloating, how the run felt…", "aria-label": "Notes for the day" });
    ta.value = r.note || "";
    ta.addEventListener("input", () => update(date, x => { x.note = ta.value; }, { silent: true }));
    ck.append(ta);
    const logged = Object.keys(r.checkin).length;
    p.append(foldCard("checkin", "How do you feel?", logged ? logged + " of 4 logged" : "optional", ck, isToday && nowMin() >= 19 * 60 && !logged));
  }
  // a card that folds away; remembers open or closed across redraws
  function foldCard(key, title, hint, body, openByDefault) {
    const d = el("details", { class: "card fold" }, el("summary", {}, el("h2", {}, title), el("span", { class: "muted small" }, hint)), body);
    d.open = key in fold ? fold[key] : openByDefault;
    // the click handler records it at once (the toggle event can lag a redraw), toggle covers every other way of opening it
    d.firstChild.addEventListener("click", () => { fold[key] = !d.open; });
    d.addEventListener("toggle", () => { fold[key] = d.open; });
    return d;
  }

  /* ---------- WORKOUT ---------- */
  function lastLift(key, before) {
    const ds = Object.keys(records).filter(d => d < before && records[d].lifts && records[d].lifts[key]).sort();
    return ds.length ? { d: ds[ds.length - 1], v: records[ds[ds.length - 1]].lifts[key] } : null;
  }
  function exItem(ex, date, log) {
    const r = rec(date);
    const meta = el("div", { class: "meta" }, el("span", { class: "sr" }, ex.sr));
    if (ex.rs) meta.append(el("button", { class: "restbtn", onclick: () => startTimer(ex.rs, ex.n), "aria-label": "Start " + ex.rest + " rest timer" },
      svg('<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>'), "Rest " + ex.rest));
    if (log) {
      const inp = el("input", { type: "text", inputmode: "decimal", id: "kg-" + date + "-" + ex.k, "aria-label": "Weight used for " + ex.n, placeholder: "–" });
      inp.value = r.lifts[ex.k] || "";
      inp.addEventListener("change", () => { const v = inp.value.trim().replace(",", "."); update(date, x => { if (v) x.lifts[ex.k] = v; else delete x.lifts[ex.k]; }); });
      meta.append(el("label", { class: "kg" }, inp, el("span", {}, "kg")));
      const last = lastLift(ex.k, date);
      if (last) meta.append(el("span", { class: "last" }, "Last: ", el("b", {}, last.v + " kg"), " · " + parse(last.d).toLocaleDateString(undefined, { day: "numeric", month: "short" })));
    }
    if (ex.note) meta.append(el("span", { class: "extra" }, ex.note));
    return el("li", { class: "ex" }, FIGS[ex.k] ? svg(FIGS[ex.k]) : el("span"), el("div", { style: "min-width:0" }, el("div", { class: "name" }, ex.n), el("div", { class: "cue" }, ex.cue), meta));
  }
  function renderWorkout() {
    const p = $("p-workout"); p.replaceChildren();
    const date = selDate, day = dayOf(date), s = SESS[day], r = rec(date), off = modeFor(date) === "office", tl = timeline(date);
    const block = (which, sess, color) => {
      const on = !!r.sessions[which], when = fmt(tl.find(x => x.id === which).t);
      const card = el("div", { class: "card" }, el("div", { class: "sesshead" },
        el("div", {}, el("div", { class: "sesstag", style: `color:var(${color})` }, (which === "am" ? "Morning" : "Evening") + " · " + when), el("div", { class: "ttl" }, sess.t)),
        el("button", { class: "done-btn", "aria-pressed": String(on), onclick: () => { buzz(); update(date, x => { x.sessions[which] = !on; }); } }, on ? "✓ Done" : "Mark done")));
      const isRun = /run|interval/i.test(sess.t);
      if (sess.desc) card.append(el("div", { class: "runbox" }, /run|interval/i.test(sess.t) ? svg(FIGS.run) : null,
        el("div", {}, sess.desc, which === "am" && off ? el("div", { class: "muted small" }, "Office day: keep it to 35-40 minutes.") : null)));
      if (isRun) { const kind = /interval/i.test(sess.t) ? 2 : /tempo/i.test(sess.t) ? 1 : 0, g = PLAN.runGuide[kind];
        card.append(el("div", { class: "effort" }, el("b", {}, "Effort: " + g[1]), el("span", { class: "muted" }, " · " + g[2] + (kind ? ". Warm-up and cool-down are easy (3-4)." : "")))); }
      if (sess.ex.length) { const ol = el("ol", { class: "exlist" }); sess.ex.forEach(ex => ol.append(exItem(ex, date, which === "pm"))); card.append(ol); }
      return card;
    };
    const first = Object.keys(records).filter(d => active(rec(d))).sort()[0] || todayStr();
    const weekNo = Math.floor((parse(date) - parse(first)) / (7 * 864e5)) + 1;
    if (weekNo <= 2 && weekNo >= 1) p.append(el("div", { class: "banner" }, el("div", {}, el("b", {}, "Week " + weekNo + " of 2: ease in"), el("ul", { class: "plain small" }, ...PLAN.easing.map(x => el("li", {}, x))))));
    const wu = el("table", { class: "ps" }); PLAN.warmup.forEach(([a, b]) => wu.append(el("tr", {}, el("td", {}, a), el("td", {}, b))));
    const warm = el("details", { class: "card warm" }, el("summary", {}, el("span", { class: "h3ish" }, "Warm-up first · 5-8 min"), el("span", { class: "muted small" }, " before every session")), wu);
    const amCard = block("am", s.am, "--am"), pmCard = s.pm ? block("pm", s.pm, "--pm") : null;
    p.append(warm);
    const pmFirst = pmCard && date === todayStr() && nowMin() >= mins(tl.find(x => x.id === "am").t) + 75;
    p.append(...(pmFirst ? [pmCard, amCard] : [amCard, pmCard]).filter(Boolean));
    if (s.pm) p.append(el("div", { class: "card" }, el("h3", {}, "How to progress"), el("ul", { class: "plain" },
      el("li", {}, "Hit the top of the rep range on every set? Add weight next time."),
      el("li", {}, "Weeks 1-2: light weights and 2 sets per exercise."),
      el("li", {}, "Every 4th week: deload, half the sets."),
      el("li", {}, "Dumbbells maxed out? Lower slowly (3-4 s) or pause at the bottom."))));
  }

  /* ---------- rest timer ---------- */
  let tmr = null, actx = null;
  function beep() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(.18, actx.currentTime); g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + .5); o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + .5); } catch (e) {} }
  function startTimer(sec, label) { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} tmr = { end: Date.now() + sec * 1000, total: sec, label, done: false }; drawTimer(); }
  function drawTimer() {
    const t = $("timer"); if (!tmr) { t.hidden = true; return; }
    const left = Math.max(0, Math.round((tmr.end - Date.now()) / 1000));
    if (left === 0 && !tmr.done) { tmr.done = true; beep(); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {} }
    t.hidden = false; t.classList.toggle("finished", left === 0);
    t.replaceChildren(el("div", { class: "t" }, left === 0 ? "Go" : Math.floor(left / 60) + ":" + pad(left % 60)),
      el("div", { style: "min-width:0" }, el("div", { class: "lbl" }, left === 0 ? "Rest over · next set" : "Rest · " + tmr.label), el("div", { class: "tbar" }, el("i", { style: `width:${100 * (1 - left / tmr.total)}%` }))),
      el("div", { class: "tb" }, left > 0 ? el("button", { onclick: () => { tmr.end += 30000; tmr.total += 30; drawTimer(); }, "aria-label": "Add 30 seconds" }, "+30") : null,
        el("button", { onclick: () => { tmr = null; drawTimer(); } }, left === 0 ? "Close" : "Skip")));
  }
  setInterval(() => { if (tmr) drawTimer(); }, 250);

  /* ---------- PROGRESS ---------- */
  function streaks() {
    const good = d => doneCount(d) >= R.goodDay;
    let cur = 0, d = new Date(); if (!good(ymd(d))) d = addDays(d, -1);
    while (good(ymd(d))) { cur++; d = addDays(d, -1); }
    let best = 0, run = 0, prev = null;
    for (const k of Object.keys(records).filter(good).sort()) { run = prev && ymd(addDays(parse(prev), 1)) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; }
    return { cur, best: Math.max(best, cur) };
  }
  function bars(vals) {
    const w = 200, h = 34, bw = w / vals.length;
    let s = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="${h - 1}" x2="${w}" y2="${h - 1}" style="stroke:var(--line)"/>`;
    vals.forEach((v, i) => { if (v == null) return; const bh = (v / 5) * (h - 4); s += `<rect x="${i * bw + 1}" y="${h - 1 - bh}" width="${Math.max(2, bw - 2)}" height="${bh}" rx="1.5" style="fill:${v <= 2 ? "var(--warn)" : "var(--ok)"}"/>`; });
    return svg(s + "</svg>");
  }
  function renderProgress() {
    const p = $("p-progress"); p.replaceChildren();
    const today = new Date(), ws = addDays(today, -dow(today)), st = streaks();
    let good = 0, sess = 0; for (let i = 0; i < 7; i++) { const d = ymd(addDays(ws, i)), r = rec(d); if (doneCount(d) >= R.goodDay) good++; sess += (r.sessions.am ? 1 : 0) + (r.sessions.pm ? 1 : 0); }
    const last7 = [...Array(7)].map((_, i) => ymd(addDays(today, -i))).filter(d => records[d] && active(rec(d)));
    const avgP = last7.length ? Math.round(last7.reduce((s, d) => s + protein(d), 0) / last7.length) : 0;
    const sleeps = [...Array(7)].map((_, i) => sleepMinutes(ymd(addDays(today, -i)))).filter(v => v != null);
    const avgS = sleeps.length ? hm(Math.round(sleeps.reduce((a, b) => a + b, 0) / sleeps.length)) : "–";
    p.append(el("div", { class: "kpis" },
      el("div", { class: "kpi" }, el("small", {}, "Current streak"), el("b", { class: "num" }, String(st.cur)), el("small", {}, "good days in a row (best " + st.best + ")")),
      el("div", { class: "kpi" }, el("small", {}, "Sessions this week"), el("b", { class: "num" }, sess + "/13"), el("small", {}, good + " good days so far")),
      el("div", { class: "kpi" }, el("small", {}, "Avg protein, 7 days"), el("b", { class: "num" }, avgP ? avgP + " g" : "–"), el("small", {}, "target 120-130 g")),
      el("div", { class: "kpi" }, el("small", {}, "Avg sleep, 7 days"), el("b", { class: "num", style: "font-size:24px" }, avgS), el("small", {}, "from Lights out + Wake up"))));

    const heat = el("div", { class: "heat" }, el("span"), ...DAYS.map(d => el("span", { class: "hd" }, d.slice(0, 2))));
    const start = addDays(ws, -21);
    for (let w = 0; w < 4; w++) {
      heat.append(el("span", { class: "wk" }, addDays(start, w * 7).toLocaleDateString(undefined, { day: "numeric", month: "short" })));
      for (let i = 0; i < 7; i++) {
        const dd = addDays(start, w * 7 + i), ds = ymd(dd), c = doneCount(ds), fut = ds > todayStr();
        const lvl = c === 0 ? "" : c >= NH ? "l4" : c >= R.goodDay ? "l3" : c >= 6 ? "l2" : "l1";
        heat.append(el("button", { class: "c " + lvl + (fut ? " future" : "") + (ds === todayStr() ? " istoday" : ""), disabled: fut || null,
          "aria-label": dd.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }) + ": " + c + " of " + NH + " habits",
          onclick: () => { selDate = ds; go("today"); } }, fut ? "" : String(dd.getDate())));
      }
    }
    p.append(el("div", { class: "card" }, el("div", { class: "cardhead" }, el("h2", {}, "Last 4 weeks")), heat,
      el("div", { class: "legend" }, "Fewer", ...[0, 1, 2, 3, 4].map(i => el("i", { style: `background:var(--heat${i})` })), "More · tap a day to open it")));

    const days14 = [...Array(14)].map((_, i) => ymd(addDays(today, -i))).filter(d => records[d] && active(rec(d)));
    if (!days14.length) { p.append(el("div", { class: "empty" }, "Trends show up here once you start logging your day plan on the Today tab.")); return; }
    const H14 = days14.map(habits);
    const rates = PLAN.habits.map(([label, , rule]) => ({ label, pct: Math.round(100 * H14.filter(h => h[rule][0] === true).length / days14.length) })).sort((a, b) => a.pct - b.pct);
    const rl = el("div", { class: "rates" });
    rates.forEach(x => rl.append(el("div", { class: "rate" + (x.pct < 50 ? " low" : "") }, el("span", {}, x.label), el("span", { class: "pct" }, x.pct + "%"), el("div", { class: "bar" }, el("i", { style: `width:${x.pct}%` })))));
    const tr = el("div");
    const d14 = [...Array(14)].map((_, i) => ymd(addDays(today, i - 13)));
    for (const [k, lab] of [["energy", "Energy"], ["sleep", "Sleep"], ["skin", "Skin"], ["gut", "Digestion"]]) {
      const vals = d14.map(d => rec(d).checkin[k] || null), got = vals.filter(v => v != null);
      tr.append(el("div", { class: "trend" }, el("span", { class: "tl-lab" }, lab), bars(vals), el("span", { class: "avg" }, got.length ? (got.reduce((a, b) => a + b, 0) / got.length).toFixed(1) : "–")));
    }
    p.append(el("div", { class: "cols" },
      el("div", { class: "card" }, el("div", { class: "cardhead" }, el("h2", {}, "Habit hit rate"), el("span", { class: "muted small" }, "days logged, last 14 · weakest first")), rl),
      el("div", { class: "card" }, el("div", { class: "cardhead" }, el("h2", {}, "How you've felt"), el("span", { class: "muted small" }, "last 14 days · avg of 5")), tr,
        el("p", { class: "muted small", style: "margin:8px 0 0" }, "Skin and hair change slowly. Give a fix 4-8 weeks before judging it."))));
  }

  /* ---------- GUIDE + data ---------- */
  async function exportData() {
    const obj = store.exportObject(), name = "routine-backup-" + todayStr() + ".json";
    if (!store.download) { toast("Export isn't available here"); return; }
    try { await store.download(name, JSON.stringify(obj, null, 1)); await store.markBackedUp(); toast("Exported " + Object.keys(obj.records).length + (Object.keys(obj.records).length === 1 ? " day" : " days")); render(); }
    catch (e) { if (!(e && e.code === "declined")) toast("Export didn't finish"); }
  }
  async function importFile(file) {
    try {
      const incoming = Store.validate(JSON.parse(await file.text()));
      const { chosen, added, updated } = Store.merge(records, incoming);
      await store.importRecords(chosen);
      Object.assign(records, chosen);
      toast(added || updated ? `Imported: ${added} new day${added === 1 ? "" : "s"}, ${updated} updated` : "Nothing new in that file");
      render();
    } catch (e) { toast(e.message && e.message.length < 80 ? e.message : "Couldn't read that file"); }
  }
  // passcode forms: each field is a password input; submit calls an Auth method that resolves to an error message or null
  function lockForm(fields, button, run) {
    const msg = el("div", { class: "lockmsg small", role: "alert" });
    return el("form", { class: "stack", novalidate: true, onsubmit: async e => {
      e.preventDefault(); msg.textContent = "";
      const err = await run(Object.fromEntries(fields.map(([id]) => [id, $("lk-" + id).value])));
      if (err) msg.textContent = err;
    } }, ...fields.map(([id, label, auto]) => el("label", { class: "fld", for: "lk-" + id }, label,
      el("input", { type: "password", id: "lk-" + id, autocomplete: auto, autocapitalize: "off", spellcheck: "false" }))), msg,
      el("button", { class: "go", type: "submit" }, button));
  }
  function lockCard() {
    const on = Auth.enabled(), min = "Passcode (at least " + Auth.minLen + " characters)";
    const card = el("div", { class: "card" }, el("div", { class: "cardhead" }, el("h2", {}, "App lock"), el("span", { class: "muted small" }, on ? "On" : "Off")));
    if (!Auth.supported) { card.append(el("p", { class: "small muted", style: "margin:0" }, "A passcode needs a secure page (https or localhost).")); return card; }
    if (!on) {
      card.append(el("p", { class: "small", style: "margin:0 0 10px" }, "Ask for a passcode when the app opens, so nobody else can read your log on this device. Digits are fine."),
        lockForm([["new", min, "new-password"], ["again", "Type it again", "new-password"]], "Turn on lock",
          async v => { const err = await Auth.setPasscode(v.new, v.again); if (!err) { toast("App lock is on"); render(); } return err; }));
      return card;
    }
    const sel = el("select", { id: "lk-auto", onchange: () => { Auth.setAutoMs(Number(sel.value)); toast("Auto-lock updated"); } },
      ...Auth.autoOptions.map(([label, ms]) => el("option", { value: ms, selected: ms === Auth.autoMs() }, label)));
    card.append(el("button", { class: "go", type: "button", onclick: () => Auth.lock() }, "Lock now"),
      el("label", { class: "fld", for: "lk-auto", style: "margin-top:12px" }, "Lock automatically", sel),
      el("details", {}, el("summary", {}, "Change passcode"), lockForm([["cur", "Current passcode", "current-password"], ["new", min.replace("Passcode", "New passcode"), "new-password"], ["again", "Type the new one again", "new-password"]], "Save passcode",
        async v => { const err = await Auth.setPasscode(v.new, v.again, v.cur); if (!err) { toast("Passcode changed"); render(); } return err; })),
      el("details", {}, el("summary", {}, "Turn off lock"), lockForm([["cur", "Current passcode", "current-password"]], "Turn off",
        async v => { const err = await Auth.removePasscode(v.cur); if (!err) { toast("App lock is off"); render(); } return err; })),
      el("p", { class: "muted small", style: "margin:10px 0 0" }, "The lock hides the app on this device. It doesn't encrypt the log. Forgot the passcode? Use the link on the lock screen."));
    return card;
  }
  function displayCard() {
    const cur = pref.get("theme", "auto");
    const card = el("div", { class: "card" }, el("div", { class: "cardhead" }, el("h2", {}, "Display")),
      el("div", { class: "setrow" }, el("span", {}, "Theme"),
        el("div", { class: "seg", role: "group", "aria-label": "Theme" }, ...[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([v, label]) =>
          el("button", { type: "button", "aria-pressed": String(cur === v), onclick: () => { pref.set("theme", v); applyTheme(); render(); } }, label)))));
    if (navigator.wakeLock) {
      const cb = el("input", { type: "checkbox", id: "wake-pref", onchange: () => { pref.set("wake", cb.checked ? "1" : "0"); syncWake(); } });
      cb.checked = pref.get("wake", "1") === "1";
      card.append(el("label", { class: "setrow", for: "wake-pref" }, el("span", {}, "Keep the screen on in Workout", el("small", { class: "muted" }, "Stops the phone locking between sets")), cb));
    }
    return card;
  }

  function renderGuide() {
    const p = $("p-guide"); p.replaceChildren();
    const lb = store.meta().lastBackup;
    const fileIn = el("input", { type: "file", accept: "application/json,.json", id: "importFile", class: "visually-hidden" });
    fileIn.addEventListener("change", () => { if (fileIn.files[0]) importFile(fileIn.files[0]); fileIn.value = ""; });
    p.append(el("div", { class: "card" }, el("div", { class: "cardhead" }, el("h2", {}, "Your data"), el("span", { class: "muted small" }, store.label)),
      el("p", { class: "small", style: "margin:0 0 10px" }, store.kind === "local"
        ? "Everything you log is one JSON file kept in this browser. Export it to back up or move to another phone, then Import it there. Importing merges days and keeps the newer copy of each."
        : "Everything you log syncs to your Claude account. Export gives you the same JSON file the GitHub Pages version can import."),
      el("div", { class: "pair wide" },
        store.download ? el("button", { class: "go", onclick: exportData }, "Export .json") : null,
        el("label", { class: "go ghost filebtn", for: "importFile" }, "Import .json"), fileIn),
      el("p", { class: "muted small", style: "margin:10px 0 0" }, Object.keys(records).length + (Object.keys(records).length === 1 ? " day" : " days") + " logged · " + (lb ? "last backup " + new Date(lb).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "never backed up"))));

    p.append(foldCard("settings", "Settings", "app lock · theme · screen", el("div", { class: "cols" }, window.Auth && Auth.why !== "claude" ? lockCard() : null, displayCard()), false));

    p.append(el("div", { class: "card" }, el("div", { class: "cardhead" }, el("h2", {}, "Daily targets"), el("span", { class: "muted small" }, PLAN.profile)),
      el("div", { class: "targets" }, ...PLAN.targets.map(([n, v, s]) => el("div", {}, el("small", {}, n), el("b", {}, v), el("small", {}, s))))));
    const rg = el("table", { class: "ps three" }); PLAN.runGuide.forEach(([a, b, c]) => rg.append(el("tr", {}, el("td", {}, el("b", {}, a)), el("td", {}, b), el("td", {}, c))));
    p.append(el("div", { class: "cols" },
      el("div", { class: "card" }, el("h2", { style: "margin-bottom:6px" }, "Running effort"), rg),
      el("div", { class: "card" }, el("h2", { style: "margin-bottom:6px" }, "Sunday reset"), el("ul", { class: "plain" }, ...PLAN.sunday.map(x => el("li", {}, x))),
        el("p", { class: "muted small", style: "margin:8px 0 0" }, "It's also a task on Sunday's day plan."))));
    const fixes = el("div", { class: "card" }, el("h2", { style: "margin-bottom:4px" }, "Fixes for what you're working on"));
    Object.entries(PLAN.issues).forEach(([k, items]) => fixes.append(el("details", {}, el("summary", {}, k), el("ul", {}, ...items.map(x => el("li", {}, x))))));
    const ps = el("table", { class: "ps" }); PLAN.proteinSheet.forEach(([a, b]) => ps.append(el("tr", {}, el("td", {}, a), el("td", {}, b))));
    p.append(el("div", { class: "cols" }, fixes, el("div", { class: "card" }, el("h2", { style: "margin-bottom:6px" }, "Vegetarian protein"), ps)));
    p.append(el("div", { class: "card" }, el("h2", { style: "margin-bottom:6px" }, "Supplements & tests"),
      el("ul", { class: "plain" }, ...PLAN.supps.map(([a, b]) => el("li", {}, el("b", {}, a), " – " + b)), el("li", {}, el("b", {}, "Blood test once: "), PLAN.tests)),
      el("p", { class: "muted small", style: "margin:10px 0 0" }, "General guidance, not medical advice. See a doctor or dermatologist if acne, hair loss, gut problems or fatigue persist.")));
  }

  /* ---------- routing & render ---------- */
  function go(t) { tab = t; enter = true; try { history.replaceState(null, "", "#" + t); } catch (e) {} render(); window.scrollTo({ top: 0 }); }
  VIEWS.forEach(t => $("tab-" + t).addEventListener("click", () => go(t)));
  $("backToday").addEventListener("click", () => { selDate = todayStr(); enter = true; render(); });
  $("modeWfh").addEventListener("click", () => update(selDate, x => { x.mode = "wfh"; }));
  $("modeOffice").addEventListener("click", () => update(selDate, x => { x.mode = "office"; }));
  const step = n => { selDate = ymd(addDays(parse(selDate), n)); editing = null; enter = true; render(); };
  $("prevDay").addEventListener("click", () => step(-1));
  $("nextDay").addEventListener("click", () => step(1));
  $("lockNow").addEventListener("click", () => window.Auth && Auth.lock());

  // keep the screen awake while the Workout tab is open (opt-out in Guide), so the phone doesn't lock between sets
  let wl = null, wlBusy = false;
  async function syncWake() {
    if (!navigator.wakeLock || wlBusy) return;
    const want = pref.get("wake", "1") === "1" && tab === "workout" && document.visibilityState === "visible";
    if (want === !!wl) return;
    wlBusy = true;
    try { if (want) { wl = await navigator.wakeLock.request("screen"); wl.addEventListener("release", () => { wl = null; }); } else { await wl.release(); wl = null; } }
    catch (e) { wl = null; }
    wlBusy = false;
  }
  document.addEventListener("visibilitychange", syncWake);

  // every tap rebuilds the panel, which would drop keyboard focus; remember which button it was on and put it back.
  // Only when the panel still has the same number of controls, so focus never lands on something unrelated.
  const FOCUSABLE = "button:not([disabled]),input:not([disabled]),textarea,summary,select";
  function focusKey() {
    const ae = document.activeElement, box = ae && ae.matches("button,summary") ? ae.closest("#days,section[role=tabpanel]") : null;
    if (!box) return null;
    const all = [...box.querySelectorAll(FOCUSABLE)];
    return { id: box.id, at: all.indexOf(ae), n: all.length, ae };
  }
  function restoreFocus(k) {
    if (!k || k.at < 0 || k.ae.isConnected) return;
    const all = [...$(k.id).querySelectorAll(FOCUSABLE)];
    if (all.length === k.n) all[k.at].focus({ preventScroll: true });
  }

  let pendingRender = false;
  function render() {
    const ae = document.activeElement;
    if (ae && (ae.tagName === "TEXTAREA" || (ae.tagName === "INPUT" && ["text", "time", "password"].includes(ae.type)))) { pendingRender = true; return; }
    pendingRender = false;
    const fk = focusKey();
    renderHeader();
    VIEWS.forEach(t => { $("p-" + t).hidden = t !== tab; $("tab-" + t).setAttribute("aria-selected", String(t === tab)); });
    ({ today: renderToday, workout: renderWorkout, progress: renderProgress, guide: renderGuide })[tab]();
    fresh = null;
    if (enter) { enter = false; const panel = $("p-" + tab); panel.classList.remove("enter"); void panel.offsetWidth; panel.classList.add("enter"); setTimeout(() => panel.classList.remove("enter"), 800); }
    restoreFocus(fk); syncWake();
  }
  document.addEventListener("focusout", () => setTimeout(() => { if (pendingRender) render(); }, 0));
  let lastMin = nowMin(), lastDay = todayStr();
  setInterval(() => {
    const m = nowMin(), d = todayStr();
    if (d !== lastDay) { if (selDate === lastDay) selDate = d; lastDay = d; render(); }
    else if (m !== lastMin && tab === "today" && selDate === d) render();
    lastMin = m;
  }, 15000);

  const h = (location.hash || "").slice(1); if (VIEWS.includes(h)) tab = h;
  render();

  // offline support when hosted (GitHub Pages / S3 over https)
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost") && !(window.claude && window.claude.use)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
