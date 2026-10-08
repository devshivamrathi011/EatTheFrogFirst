/* App lock for the Daily Routine Tracker.
 *
 * Keeps casual visitors out: someone who picks up your phone, or finds the public URL, sees a passcode screen
 * instead of the app. Only a salted PBKDF2 hash of the passcode is stored (in localStorage), never the passcode.
 *
 * This is a lock on the interface, not encryption. A static site has no server to check a login against, so
 * anyone who can open browser devtools on this device can still read the stored log. See the README for options
 * that keep the files themselves private.
 */
(function () {
  const KEY = "routine-auth-v1", FAIL = "routine-auth-fail", SKIP = "routine-auth-skip", OPEN = "routine-auth-open";
  const ITER = 600000, MIN_LEN = 4, DEFAULT_AUTO = 5 * 60000;
  const AUTO = [["Immediately", 0], ["After 1 minute", 60000], ["After 5 minutes", 300000], ["After 15 minutes", 900000], ["Only when the app is closed", -1]];
  const inClaude = !!(window.claude && window.claude.use);
  const supported = !!(window.crypto && crypto.subtle) && !inClaude;
  const why = inClaude ? "claude" : supported ? null : "insecure";

  /* ---------- storage ---------- */
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
  };
  const enabled = () => supported && !!ls.get(KEY);
  const autoMs = () => { const r = ls.get(KEY); return r && typeof r.auto === "number" ? r.auto : DEFAULT_AUTO; };

  /* ---------- hashing ---------- */
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const norm = s => String(s).normalize("NFKC");
  async function derive(pass, salt, iter) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(norm(pass)), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
  }
  function same(a, b) { let d = a.length ^ b.length; for (let i = 0; i < a.length; i++) d |= a[i] ^ (b[i] || 0); return d === 0; }
  async function check(pass) {
    const r = ls.get(KEY); if (!r) return true;
    try { return same(await derive(pass, unb64(r.salt), r.iter), unb64(r.hash)); } catch (e) { return false; }
  }
  async function save(pass, auto) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), hash = await derive(pass, salt, ITER);
    if (!ls.set(KEY, { v: 1, iter: ITER, salt: b64(salt), hash: b64(hash), auto, num: /^\d+$/.test(norm(pass)) })) return "Couldn't save it: this browser is blocking site storage.";
    ls.del(FAIL); ls.del(SKIP); markOpen();
    return null;
  }

  /* ---------- wrong-guess throttle: 5 free tries, then 30 s, 60 s, 2 min ... up to 15 min ---------- */
  const wait = () => Math.max(0, Math.ceil(((ls.get(FAIL) || {}).until - Date.now()) / 1000) || 0);
  function failed() {
    const f = ls.get(FAIL) || { n: 0, until: 0 }; f.n++;
    if (f.n >= 5) f.until = Date.now() + Math.min(900, 30 * 2 ** (f.n - 5)) * 1000;
    ls.set(FAIL, f);
  }
  async function verify(pass) {
    const w = wait(); if (w) return "Too many attempts. Try again in " + w + " s.";
    if (await check(pass)) { ls.del(FAIL); return null; }
    failed(); return "That passcode is wrong.";
  }
  const problem = (pass, again) => norm(pass).length < MIN_LEN ? "Use at least " + MIN_LEN + " characters." : again !== undefined && pass !== again ? "The two passcodes don't match." : null;

  /* ---------- "still unlocked" memory for this tab/app session ---------- */
  // never while the lock screen is up, or a reload would let you straight past it
  function markOpen() { if (!locked) ss.set(OPEN, String(Date.now())); }
  function stillOpen() { const t = Number(ss.get(OPEN)); if (!t) return false; const a = autoMs(); return a < 0 || Date.now() - t < a; }

  /* ---------- screens ---------- */
  const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === null || v === undefined || v === false) continue; if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v); }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
    return e;
  }
  const brand = title => { const b = h("div", { class: "brand" }); b.innerHTML = LOCK_ICON; b.append(h("div", {}, h("div", { class: "eyebrow" }, "Daily Routine Tracker"), h("h1", { id: "lockTitle" }, title))); return b; };
  const cover = on => {
    for (const n of [document.querySelector(".wrap"), document.getElementById("timer"), document.getElementById("toast")]) if (n) n.toggleAttribute("inert", on);
    document.documentElement.classList.toggle("locked", on); // stops the page behind from scrolling
  };
  let locked = false;

  function open(box) {
    const wrap = h("div", { class: "lock", role: "dialog", "aria-modal": "true", "aria-labelledby": "lockTitle" }, box);
    document.body.append(wrap); cover(true);
    return () => { wrap.remove(); cover(false); };
  }

  function showUnlock() {
    if (locked) return Promise.resolve();
    locked = true; ss.set(OPEN, "0");
    const back = document.activeElement, numeric = !!(ls.get(KEY) || {}).num;
    return new Promise(resolve => {
      let tm = 0;
      const inp = h("input", { type: "password", id: "lockPass", autocomplete: "current-password", "aria-label": "Passcode", "aria-describedby": "lockMsg", inputmode: numeric ? "numeric" : null, enterkeyhint: "go", autocapitalize: "off", spellcheck: "false" });
      const msg = h("div", { class: "lockmsg", id: "lockMsg", role: "alert" }), count = h("span", { "aria-hidden": "true" });
      const go = h("button", { class: "lockgo", type: "submit" }, "Unlock");
      const sure = h("button", { class: "lockdanger", type: "button" }, "Erase data and remove the lock");
      const reset = h("div", { class: "lockreset", hidden: true }, h("div", {}, "A forgotten passcode can't be recovered. You can erase this browser's tracker data and lock, then bring your log back with Import .json from a backup you exported earlier."), sure);
      const forgot = h("button", { class: "locklink", type: "button", "aria-expanded": "false", onclick: () => { reset.hidden = !reset.hidden; forgot.setAttribute("aria-expanded", String(!reset.hidden)); } }, "Forgot passcode?");
      let armed = false;
      sure.addEventListener("click", () => { if (!armed) { armed = true; sure.textContent = "Tap again to erase everything"; return; } erase(); });
      const form = h("form", { class: "lockbox", novalidate: true }, brand("Locked"), h("p", {}, "Enter your passcode to open the tracker."), inp, h("div", { class: "lockrow" }, msg, count), go, forgot, reset);
      const close = open(form);
      const tick = () => {
        clearTimeout(tm); const w = wait();
        count.textContent = w ? w + " s" : "";
        inp.disabled = go.disabled = !!w;
        if (w) tm = setTimeout(tick, 1000); else { if (msg.dataset.wait) { msg.textContent = ""; delete msg.dataset.wait; } inp.focus(); }
      };
      form.addEventListener("submit", async e => {
        e.preventDefault(); if (!inp.value || go.disabled) return;
        go.disabled = true; msg.textContent = "";
        const err = await verify(inp.value); go.disabled = false;
        if (!err) { clearTimeout(tm); locked = false; markOpen(); close(); try { back && back.isConnected && back.focus({ preventScroll: true }); } catch (x) {} resolve(); return; }
        inp.value = ""; msg.textContent = wait() ? "Too many attempts. Please wait." : err; if (wait()) msg.dataset.wait = "1";
        tick(); if (!wait()) inp.focus();
      });
      tick(); if (!wait()) inp.focus();
    });
  }

  function showSetup() {
    return new Promise(resolve => {
      const a = h("input", { type: "password", id: "setPass", autocomplete: "new-password", autocapitalize: "off", spellcheck: "false" });
      const b = h("input", { type: "password", id: "setPass2", autocomplete: "new-password", autocapitalize: "off", spellcheck: "false" });
      const show = h("input", { type: "checkbox", id: "setShow", onchange: () => { a.type = b.type = show.checked ? "text" : "password"; } });
      const msg = h("div", { class: "lockmsg", role: "alert" });
      const go = h("button", { class: "lockgo", type: "submit" }, "Set passcode");
      const skip = h("button", { class: "locklink", type: "button" }, "Not now");
      const form = h("form", { class: "lockbox", novalidate: true }, brand("Protect this app"),
        h("p", {}, "Choose a passcode so nobody else can open your log on this device. Digits are fine. You can change it or turn it off later in Guide."),
        h("label", { class: "fld", for: "setPass" }, "Passcode (at least " + MIN_LEN + " characters)", a),
        h("label", { class: "fld", for: "setPass2" }, "Type it again", b),
        h("label", { class: "chk" }, show, " Show passcode"), msg, go, skip);
      const close = open(form);
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const p = problem(a.value, b.value); if (p) { msg.textContent = p; return; }
        go.disabled = true; msg.textContent = "Saving…";
        const err = await save(a.value, DEFAULT_AUTO);
        if (err) { msg.textContent = err; go.disabled = false; return; }
        close(); resolve();
      });
      skip.addEventListener("click", () => { ls.set(SKIP, 1); close(); resolve(); });
      a.focus();
    });
  }

  /* wipes this browser's tracker data and lock: the only way back in after forgetting the passcode */
  function erase() {
    try {
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.startsWith("routine-") || k.startsWith("trk:"))) drop.push(k); }
      drop.forEach(k => localStorage.removeItem(k)); sessionStorage.clear();
    } catch (e) {}
    location.reload();
  }

  /* ---------- re-lock when you come back after being away ---------- */
  let hiddenAt = 0;
  if (supported) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); markOpen(); return; }
      const away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0;
      if (away && enabled() && !locked) { const a = autoMs(); if (a >= 0 && away >= a) showUnlock(); }
    });
    window.addEventListener("pagehide", markOpen);
  }

  window.Auth = {
    supported, why, minLen: MIN_LEN, autoOptions: AUTO,
    enabled, autoMs, locked: () => locked,
    /* resolves once the app may start: immediately when no lock is set, after unlock otherwise */
    async gate() {
      if (!supported) return;
      if (enabled()) { if (stillOpen()) markOpen(); else await showUnlock(); return; }
      if (!ls.get(SKIP)) await showSetup();
    },
    lock() { if (enabled()) showUnlock(); },
    /* each of these resolves to null on success or a message to show the person */
    async setPasscode(next, again, current) {
      if (!supported) return "A passcode needs a secure (https) page.";
      if (enabled()) { const err = await verify(current || ""); if (err) return err.replace("That passcode", "The current passcode"); }
      const p = problem(next, again); if (p) return p;
      return save(next, autoMs());
    },
    async removePasscode(current) {
      const err = await verify(current || ""); if (err) return err;
      ls.del(KEY); ls.set(SKIP, 1); return null;
    },
    setAutoMs(ms) { const r = ls.get(KEY); if (r) { r.auto = ms; ls.set(KEY, r); } },
  };
})();
