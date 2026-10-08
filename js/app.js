/* Daily Routine Tracker. Habits are never ticked by hand: each one is worked out from what you log
 * (tasks done, meals eaten, water, workouts, bed and wake times). Plan content lives in data/*.json. */
(async function () {
  const $ = id => document.getElementById(id);
  const VIEWS = ["today", "workout", "progress", "guide"];
  const FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

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
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} };
  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2400); }
  const setStatus = s => ($("status").textContent = s);

  /* ---------- saving ---------- */
  const dirty = new Set(), timers = {};
  let chain = Promise.resolve();
  function update(date, fn, opts = {}) {
    const before = doneCount(date);
    const r = rec(date); if (!r.mode) r.mode = modeFor(date);
    fn(r); r.v = 2; r.updatedAt = new Date().toISOString();
    records[date] = r; dirty.add(date);
    clearTimeout(timers[date]); if (store.kind === "local") flush(date); else timers[date] = setTimeout(() => flush(date), 400);
    if (!opts.silent) render();
    const after = doneCount(date);
    if (after === NH && before < NH) toast("All " + NH + " habits done. Great day.");
    else if (after >= R.goodDay && before < R.goodDay) toast("Good day: " + after + " / " + NH + " habits");
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
    if (it.kind === "meal") return update(date, x => { x.meals[it.id] = !r.meals[it.id]; });
    if (it.kind === "session") return update(date, x => { x.sessions[it.id] = !r.sessions[it.id]; });
    if (r.tasks[it.id]) { editing = editing === date + it.id ? null : date + it.id; return render(); }
    let target = date, time = date === todayStr() ? hhmm(new Date()) : it.t;
    // Lights out tapped just after midnight belongs to the night before
    if (it.id === "sleep" && date === todayStr() && nowMin() < 4 * 60) target = ymd(addDays(new Date(), -1));
    update(target, x => { x.tasks[it.id] = time; });
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
    const box = $("days"); box.replaceChildren();
    const ws = addDays(d, -dow(d));
    for (let i = 0; i < 7; i++) {
      const dt = ymd(addDays(ws, i)), c = doneCount(dt);
      const lvl = c === 0 ? 0 : c >= NH ? 4 : c >= R.goodDay ? 3 : c >= 6 ? 2 : 1;
      box.append(el("button", { "aria-pressed": String(dt === selDate), class: dt === todayStr() ? "today" : null, "aria-label": FULL[DAYS[i]] + ", " + c + " of " + NH + " habits", onclick: () => { selDate = dt; editing = null; render(); } },
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
      el("button", { class: "act ghost", onclick: () => { editing = null; update(date, x => { delete x.tasks[it.id]; }); } }, "Undo"));
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

    // now / next
    if (isToday) {
      const nm = nowMin(); let ci = -1; tl.forEach((it, i) => { if (mins(it.t) <= nm) ci = i; });
      // first thing not yet done at or before now = what to do
      let cur = ci >= 0 ? tl[ci] : null;
      const pending = tl.slice(0, ci + 1).filter(it => it.kind !== "info" && !isDoneItem(r, it));
      const focus = pending.length ? pending[pending.length - 1] : cur;
      const nxt = tl[ci + 1] || null;
      const box = el("div", { class: "now" });
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

    // stats
    const dc = doneCount(date), prot = protein(date);
    const ring = svg(`<svg class="ring${dc === NH ? " done" : ""}" viewBox="0 0 60 60" aria-hidden="true"><circle class="track" cx="30" cy="30" r="24"/><circle class="val" cx="30" cy="30" r="24" transform="rotate(-90 30 30)" stroke-dasharray="150.8" stroke-dashoffset="${150.8 * (1 - dc / NH)}"/></svg>`);
    const nj = H.nojunk;
    p.append(el("div", { class: "stats" },
      el("div", { class: "stat habitstat" }, el("div", { class: "eyebrow" }, "Habits"),
        el("div", { class: "ringwrap" }, ring, el("div", {}, el("div", { class: "big num" }, String(dc), el("small", {}, " / " + NH)),
          el("div", { class: "muted small" }, dc === NH ? "All done" : dc >= R.goodDay ? "Good day" : (R.goodDay - dc) + " more for a good day")))),
      el("div", { class: "stat" }, el("div", { class: "eyebrow" }, "Protein"),
        el("div", { class: "big num" }, String(prot), el("small", {}, " / " + R.proteinTarget + " g")),
        el("div", { class: "bar food" }, el("i", { style: `width:${Math.min(100, prot / R.proteinTarget * 100)}%` })),
        el("div", { class: "muted small" }, "Tap Eat on meals")),
      el("div", { class: "stat" }, el("div", { class: "eyebrow" }, "Water"),
        el("div", { class: "big num" }, String(r.water * R.glassMl / 1000), el("small", {}, " / " + (R.waterGlasses * R.glassMl / 1000) + " L")),
        el("div", { class: "bar water" }, el("i", { style: `width:${Math.min(100, r.water / R.waterGlasses * 100)}%` })),
        el("div", { class: "pair" },
          el("button", { "aria-label": "Remove a glass", onclick: () => update(date, x => { x.water = Math.max(0, x.water - 1); }) }, "−"),
          el("button", { class: "plus", "aria-label": "Add a " + R.glassMl + " ml glass", onclick: () => { buzz(); update(date, x => { x.water = Math.min(20, x.water + 1); }); } }, "+ " + R.glassMl + " ml"))),
      el("div", { class: "stat" }, el("div", { class: "eyebrow" }, "Junk-free"),
        el("div", { class: "big" + (r.slips ? " warn" : "") }, r.slips ? r.slips + " slip" + (r.slips > 1 ? "s" : "") : nj[0] === true ? "Yes" : "On track"),
        el("div", { class: "muted small" }, "Ate sweets or packaged snacks? Log it honestly."),
        el("div", { class: "pair" },
          el("button", { "aria-label": "Remove a slip", disabled: !r.slips || null, onclick: () => update(date, x => { x.slips = Math.max(0, x.slips - 1); }) }, "−"),
          el("button", { class: "slip", onclick: () => update(date, x => { x.slips = x.slips + 1; }) }, "Log a slip")))
    ));

    // day plan (the main thing you interact with)
    const nm = nowMin(); let ci = -1; if (isToday) tl.forEach((it, i) => { if (mins(it.t) <= nm) ci = i; });
    const list = el("ol", { class: "tl" });
    tl.forEach((it, i) => {
      const done = isDoneItem(r, it);
      const cls = [it.kind === "meal" ? "food" : it.id === "am" ? "am" : it.id === "pm" ? "pm" : it.kind === "info" ? "info" : "care",
        done ? "done" : "", isToday && i < ci && !done && it.kind !== "info" ? "missed" : "", i === ci ? "current" : ""].join(" ");
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
    const habitsCard = el("div", { class: "card" }, el("div", { class: "cardhead" }, el("h2", {}, "Habits"), el("span", { class: "muted small" }, "Fill in automatically from your day plan")), hl);

    p.append(el("div", { class: "cols" }, planCard, habitsCard));

    // check-in
    const ck = el("div", { class: "card" }, el("div", { class: "cardhead" }, el("h2", {}, "How do you feel?"), el("span", { class: "muted small" }, "Shows whether the fixes work")));
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
    p.append(ck);
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
  function go(t) { tab = t; try { history.replaceState(null, "", "#" + t); } catch (e) {} render(); window.scrollTo({ top: 0 }); }
  VIEWS.forEach(t => $("tab-" + t).addEventListener("click", () => go(t)));
  $("backToday").addEventListener("click", () => { selDate = todayStr(); render(); });
  $("modeWfh").addEventListener("click", () => update(selDate, x => { x.mode = "wfh"; }));
  $("modeOffice").addEventListener("click", () => update(selDate, x => { x.mode = "office"; }));

  let pendingRender = false;
  function render() {
    const ae = document.activeElement;
    if (ae && (ae.tagName === "TEXTAREA" || (ae.tagName === "INPUT" && (ae.type === "text" || ae.type === "time")))) { pendingRender = true; return; }
    pendingRender = false;
    renderHeader();
    VIEWS.forEach(t => { $("p-" + t).hidden = t !== tab; $("tab-" + t).setAttribute("aria-selected", String(t === tab)); });
    ({ today: renderToday, workout: renderWorkout, progress: renderProgress, guide: renderGuide })[tab]();
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
