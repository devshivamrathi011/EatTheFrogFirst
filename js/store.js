/* Storage for the Daily Routine Tracker.
 *
 * The whole database is ONE JSON document:
 *   { "app": "daily-routine-tracker", "version": 2,
 *     "meta":    { "created": "...", "lastBackup": "..." },
 *     "records": { "2026-10-07": { ...one day... }, ... } }
 *
 * On GitHub Pages / S3 (static hosting) the server cannot be written to, so the JSON lives in the
 * browser (localStorage) and you move it between devices with Export / Import (a .json file).
 * When the page runs as a claude.ai artifact, the same records sync to your Claude account instead.
 */
(function () {
  const KEY = "routine-db-v2";
  const APP = "daily-routine-tracker";
  const empty = () => ({ app: APP, version: 2, meta: { created: new Date().toISOString(), lastBackup: null }, records: {} });

  function stamp(d) { const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }

  /* ---------- browser JSON database ---------- */
  function localAdapter() {
    let db = empty(), ok = true;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const j = JSON.parse(raw); if (j && j.records) db = { ...empty(), ...j, meta: { ...empty().meta, ...(j.meta || {}) } }; }
      else {
        // migrate per-day keys written by the first version of the page
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("trk:")) db.records[k.slice(4)] = JSON.parse(localStorage.getItem(k));
        }
      }
    } catch (e) { ok = false; }
    let listener = null;
    const write = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); ok = true; } catch (e) { ok = false; } };
    window.addEventListener("storage", e => {
      if (e.key !== KEY || !e.newValue) return;
      try { db = JSON.parse(e.newValue); listener && listener(db.records); } catch (err) {}
    });
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
    return {
      kind: "local",
      get label() { return ok ? "Saved in this browser" : "Browser storage is blocked here, changes will be lost on reload"; },
      records: () => db.records,
      meta: () => db.meta,
      subscribe(fn) { listener = fn; },
      async save(date, rec) { db.records[date] = rec; write(); if (!ok) throw new Error("storage"); },
      exportObject() { return { ...db, exportedAt: new Date().toISOString() }; },
      async markBackedUp() { db.meta.lastBackup = new Date().toISOString(); write(); },
      async importRecords(recs) { Object.assign(db.records, recs); write(); },
      async download(filename, text) {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      },
    };
  }

  /* ---------- claude.ai artifact (account sync) ---------- */
  async function claudeAdapter() {
    if (!(window.claude && window.claude.use)) return null;
    let db = null, user = null, dl = null;
    try { [db, user, dl] = await Promise.all([window.claude.use("db"), window.claude.use("user"), window.claude.use("downloads")]); } catch (e) { return null; }
    const uid = user ? await user.id() : null;
    if (!db || !uid) return null;
    const col = db.collection("data/users/" + uid);
    const metaRef = db.doc("data/users/" + uid + "/_meta");
    let records = {}, meta = { lastBackup: null }, listener = null;
    try { const m = await metaRef.get(); if (m.exists) meta = { ...meta, ...m.data() }; } catch (e) {}
    col.onSnapshot(snap => {
      const next = {};
      for (const d of snap.docs) { if (d.id === "_meta") continue; const v = d.data(); if (v) next[d.id] = JSON.parse(JSON.stringify(v)); }
      records = next; listener && listener(records);
    }, () => {});
    return {
      kind: "claude",
      label: "Synced to your Claude account",
      records: () => records,
      meta: () => meta,
      subscribe(fn) { listener = fn; },
      async save(date, rec) { records[date] = rec; await col.doc(date).set(JSON.parse(JSON.stringify(rec))); },
      exportObject() { return { app: APP, version: 2, meta, records, exportedAt: new Date().toISOString() }; },
      async markBackedUp() { meta.lastBackup = new Date().toISOString(); try { await metaRef.set(meta); } catch (e) {} },
      async importRecords(recs) { for (const [d, r] of Object.entries(recs)) { records[d] = r; await col.doc(d).set(r); } },
      download: dl ? async (filename, text) => { await dl.save({ filename, data: text }); } : null,
    };
  }

  /* ---------- import / merge ---------- */
  function validate(obj) {
    if (!obj || typeof obj !== "object") throw new Error("This file isn't a tracker backup.");
    const recs = obj.records;
    if (!recs || typeof recs !== "object") throw new Error("No day records found in this file.");
    const out = {};
    for (const [k, v] of Object.entries(recs)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v === "object") out[k] = v;
    }
    return out;
  }
  function merge(current, incoming) {
    // newer updatedAt wins per day; a day only in one side is kept
    const chosen = {};
    let added = 0, updated = 0;
    for (const [d, r] of Object.entries(incoming)) {
      const cur = current[d];
      if (!cur) { chosen[d] = r; added++; }
      else if ((r.updatedAt || "") > (cur.updatedAt || "")) { chosen[d] = r; updated++; }
    }
    return { chosen, added, updated };
  }

  window.Store = {
    async open() { return (await claudeAdapter()) || localAdapter(); },
    validate, merge, stamp,
  };
})();
