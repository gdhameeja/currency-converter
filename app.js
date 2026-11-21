// The converter screen: your currencies, the keypad, rate status, the
// currency picker and app updates. Rates come from rates.js; this file only
// decides when to fetch and how to show things.
(() => {
"use strict";

const REPO = "gdhameeja/currency-converter";
const STATE_KEY = "cc.state";
const RAW_KEY = "cc.raw";
const CHECKED_KEY = "cc.checkedAt";
const UPDATE_KEY = "cc.updateCheckedAt";
const LIVE_EVERY_MS = 60 * 1000; // Coinbase updates every minute
const DAILY_EVERY_MS = 60 * 60 * 1000; // the daily sources, checked hourly
const UPDATE_CHECK_MS = 6 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const STALE_MS = 3 * 86400 * 1000; // rates older than this get a warning

const { BY_CODE, ALL, POPULAR, flag } = Currencies;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ─── State ─────────────────────────────────────────────────────────────────

const DEFAULT_LIST = ["USD", "INR", "EUR", "GBP", "AED"];
let state = { list: DEFAULT_LIST.slice(), active: "USD", expr: "1", fresh: true };
try {
  const s = JSON.parse(localStorage.getItem(STATE_KEY));
  if (s && Array.isArray(s.list)) {
    const list = s.list.filter((c) => BY_CODE[c]);
    if (list.length) state = { list, active: list.includes(s.active) ? s.active : list[0], expr: typeof s.expr === "string" ? s.expr : "", fresh: true };
  }
} catch { /* first run */ }
const saveState = () => {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* storage full */ }
};

let rawStore = {}; // newest raw copy of each source, from anywhere
let bundled = {}; // the snapshot shipped in the APK
let market = { rates: {}, info: {} };
let lastAttempt = {}; // src -> { at, ok }
try { rawStore = JSON.parse(localStorage.getItem(RAW_KEY)) || {}; } catch { rawStore = {}; }
try { lastAttempt = JSON.parse(localStorage.getItem(CHECKED_KEY)) || {}; } catch { lastAttempt = {}; }
let editing = false;
let refreshing = false;
let latestRelease = null;

function recompute() {
  rawStore = Rates.combineStores(bundled, rawStore);
  const parsed = Object.keys(Rates.SOURCES).map((src) => Rates.parse(src, rawStore[src]));
  market = Rates.merge(parsed, ALL);
}

// ─── Amounts ───────────────────────────────────────────────────────────────

function activeAmount() {
  const v = Calc.evaluate(state.expr);
  return Number.isFinite(v) ? v : 0;
}

function amountIn(code) {
  return Rates.convert(activeAmount(), state.active, code, market.rates);
}

// What a row shows, as a number you could type: tapping a row carries this over
function shownValue(v) {
  if (!Number.isFinite(v) || v === 0) return 0;
  return Math.abs(v) >= 1 ? Number(v.toFixed(2)) : Number(v.toPrecision(4));
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function rowHtml(code) {
  const c = BY_CODE[code];
  const info = market.info[code];
  const active = code === state.active;
  const hasRate = market.rates[code] !== undefined && market.rates[state.active] !== undefined;
  let main, sub;
  if (active) {
    main = esc(Format.expression(state.expr));
    sub = Calc.hasOperator(state.expr) && Number.isFinite(Calc.evaluate(state.expr))
      ? "= " + esc(Format.amount(Calc.evaluate(state.expr))) : esc(c.name);
  } else if (!hasRate) {
    main = "—";
    sub = "No rate available";
  } else {
    main = esc(Format.amount(amountIn(code)));
    sub = `1 ${state.active} = ${esc(Format.rate(Rates.convert(1, state.active, code, market.rates)))} ${code}`;
  }
  let badge = "";
  if (info && info.status === "disputed") badge = '<span class="badge warn" title="Sources disagree">⚠</span>';
  else if (info && info.src !== "coinbase" && code !== "USD") badge = '<span class="badge">daily</span>';
  const controls = editing
    ? `<div class="edit-controls">
         <button class="mini" data-act="up" aria-label="Move up">↑</button>
         <button class="mini" data-act="down" aria-label="Move down">↓</button>
         <button class="mini danger" data-act="remove" aria-label="Remove">✕</button>
       </div>`
    : `<div class="amount"><div class="main">${main}</div><div class="sub">${sub}</div></div>`;
  return `<div class="row${active && !editing ? " active" : ""}" data-code="${code}">
    <div class="flag ${c.kind}">${flag(code)}</div>
    <div class="ident"><div class="code">${code}${badge}</div><div class="name">${esc(c.name)}</div></div>
    ${controls}
  </div>`;
}

function render() {
  $("list").innerHTML = state.list.map(rowHtml).join("") ||
    '<p class="empty">No currencies yet. Add one below.</p>';
  $("edit").textContent = editing ? "Done" : "Edit";
  document.body.classList.toggle("editing", editing);
  renderStatus();
}

function newestAt() {
  return Math.max(0, ...Object.keys(Rates.SOURCES).map((s) => (Rates.parse(s, rawStore[s]) || { at: 0 }).at));
}

// Did the last try to reach this source fail, after the data we have?
function failedSince(src, at) {
  const last = lastAttempt[src];
  return !!(last && !last.ok && last.at > at);
}

function renderStatus() {
  const live = Rates.parse("coinbase", rawStore.coinbase);
  const newest = newestAt();
  const el = $("status");
  el.classList.remove("ok", "old", "bad");
  let text;
  if (!newest) {
    text = refreshing ? "Loading rates…" : "No rates yet: connect to the internet";
    el.classList.add("bad");
  } else if (live && Date.now() - live.at < 10 * 60 * 1000 && !failedSince("coinbase", live.at)) {
    text = `Live · updated ${Format.age(live.at)}`;
    el.classList.add("ok");
  } else {
    const at = live ? live.at : newest;
    const offline = !navigator.onLine || failedSince("coinbase", at);
    text = `${offline ? "Offline · rates" : "Rates"} from ${Format.age(at)}`;
    el.classList.add(Date.now() - at > STALE_MS ? "bad" : "old");
  }
  if (refreshing && newest) text += " · updating";
  $("status-text").textContent = text;
  $("update-dot").hidden = !latestRelease;
  $("refresh").classList.toggle("spin", refreshing);
}

// ─── Keypad and rows ───────────────────────────────────────────────────────

function press(key) {
  state.expr = Calc.press(state.expr, key, state.fresh);
  // After "=", the result is carried like a value from another row
  state.fresh = key === "=";
  saveState();
  render();
}

$("keypad").addEventListener("click", (e) => {
  const b = e.target.closest("[data-k]");
  if (b) press(b.dataset.k);
});

// Hardware keyboards (and the desktop browser)
document.addEventListener("keydown", (e) => {
  if (!$("picker").hidden || !$("sheet").hidden) return;
  const map = { "*": "×", "/": "÷", "-": "−", "+": "+", Enter: "=", "=": "=", Backspace: "⌫", Escape: "C", Delete: "C", ",": ".", ".": ".", "%": "%" };
  const k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
  if (k) { e.preventDefault(); press(k); }
});

function makeActive(code) {
  if (code === state.active) return;
  const v = shownValue(amountIn(code));
  state.active = code;
  state.expr = Calc.toPlain(v) ?? "";
  state.fresh = true;
  saveState();
  render();
}

// Tap: type in that currency. Long press: details and copy.
let pressTimer = null, longPressed = false;
$("list").addEventListener("pointerdown", (e) => {
  const row = e.target.closest(".row");
  if (!row || editing) return;
  longPressed = false;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { longPressed = true; showCurrency(row.dataset.code); }, 500);
});
["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
  $("list").addEventListener(ev, () => clearTimeout(pressTimer)));
$("list").addEventListener("scroll", () => clearTimeout(pressTimer), { passive: true });
$("list").addEventListener("contextmenu", (e) => e.preventDefault());
$("list").addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  const code = row.dataset.code;
  const act = e.target.closest("[data-act]");
  if (act) {
    const i = state.list.indexOf(code);
    if (act.dataset.act === "remove") {
      state.list.splice(i, 1);
      if (state.active === code && state.list.length) { state.active = state.list[0]; state.expr = "1"; state.fresh = true; }
    } else {
      const j = act.dataset.act === "up" ? i - 1 : i + 1;
      if (j >= 0 && j < state.list.length) [state.list[i], state.list[j]] = [state.list[j], state.list[i]];
    }
    saveState();
    render();
    return;
  }
  if (editing || longPressed) return;
  makeActive(code);
});

$("edit").addEventListener("click", () => { editing = !editing; render(); });

// ─── Fetching ──────────────────────────────────────────────────────────────

function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { cache: "no-store", signal: ctrl.signal })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
    .finally(() => clearTimeout(t));
}

// One source: its URLs in turn until one gives a valid response
async function fetchSource(src) {
  for (const url of Rates.SOURCES[src].urls) {
    try {
      const raw = { text: await fetchText(url), fetchedAt: Date.now() };
      if (Rates.parse(src, raw)) return raw;
    } catch { /* next url */ }
  }
  return null;
}

async function refresh(force = false) {
  if (refreshing) return;
  const now = Date.now();
  const due = Object.keys(Rates.SOURCES).filter((src) => {
    const every = Rates.SOURCES[src].live ? LIVE_EVERY_MS : DAILY_EVERY_MS;
    const last = lastAttempt[src];
    return force || !rawStore[src] || !last || !last.ok || now - last.at >= every;
  });
  // What the background job fetched while the app was closed
  try { rawStore = Rates.combineStores(rawStore, await Native.stored()); } catch { /* no native side */ }
  if (!due.length) { recompute(); render(); return; }
  refreshing = true;
  renderStatus();
  const results = await Promise.all(due.map((src) => fetchSource(src).then((raw) => [src, raw])));
  for (const [src, raw] of results) {
    lastAttempt[src] = { at: Date.now(), ok: !!raw };
    if (raw) rawStore = Rates.combineStores(rawStore, { [src]: raw });
  }
  refreshing = false;
  try {
    localStorage.setItem(RAW_KEY, JSON.stringify(rawStore));
    localStorage.setItem(CHECKED_KEY, JSON.stringify(lastAttempt));
  } catch { /* storage full */ }
  recompute();
  render();
  if (force && results.every(([, raw]) => !raw)) toast("Couldn't reach the rate sources. Showing saved rates.");
}

$("refresh").addEventListener("click", () => refresh(true));
setInterval(() => { if (!document.hidden) refresh(); }, LIVE_EVERY_MS);
setInterval(renderStatus, 30 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); checkForUpdate().catch(() => {}); } });
window.addEventListener("online", () => refresh());
window.addEventListener("offline", renderStatus);

// ─── Sheets (bottom panels) and the back button ────────────────────────────

let sheetOpen = false;
function openSheet(html) {
  $("sheet").innerHTML = `<div class="grab"></div>${html}`;
  $("sheet").hidden = false;
  $("sheet-backdrop").hidden = false;
  if (!sheetOpen) history.pushState({ sheet: true }, "");
  sheetOpen = true;
}
function closeSheet(fromHistory) {
  if (!sheetOpen) return;
  sheetOpen = false;
  $("sheet").hidden = true;
  $("sheet-backdrop").hidden = true;
  if (!fromHistory) history.back();
}
$("sheet-backdrop").addEventListener("click", () => closeSheet());

let pickerOpen = false;
window.addEventListener("popstate", () => {
  if (sheetOpen) closeSheet(true);
  else if (pickerOpen) closePicker(true);
});

function sourceLine(src) {
  const p = Rates.parse(src, rawStore[src]);
  const last = lastAttempt[src];
  const s = Rates.SOURCES[src];
  const when = p ? `rates from ${Format.dateTime(p.at)} (${Format.age(p.at)})` : "no data yet";
  const fail = last && !last.ok ? ` · last try failed ${Format.age(last.at)}` : "";
  return `<li><b>${esc(s.name)}</b> <span class="muted">${s.live ? "live" : "daily"}</span><br><span class="muted">${when}${fail}</span></li>`;
}

function showStatus() {
  const mine = state.list.filter((c) => market.info[c]);
  const disputed = mine.filter((c) => market.info[c].status === "disputed");
  const daily = mine.filter((c) => market.info[c].status !== "disputed" && market.info[c].src !== "coinbase" && c !== "USD");
  openSheet(`
    <h2>Rates</h2>
    <ul class="sources">${Object.keys(Rates.SOURCES).map(sourceLine).join("")}</ul>
    <p class="muted small">Mid-market rates (what banks trade at, before their markup). Each rate
    is checked against the other sources and used only when at least two agree; the
    freshest agreeing one wins. Without internet, the last rates fetched are used: the
    app also refreshes them in the background about every 12 hours.</p>
    ${disputed.length ? `<p class="warn-text">⚠ Sources disagree on ${disputed.join(", ")}. Long-press the currency to compare.</p>` : ""}
    ${daily.length ? `<p class="muted small">${daily.join(", ")}: no live rate that agrees, using the daily rate.</p>` : ""}
    <div class="sheet-actions"><button class="btn" id="sh-refresh">Refresh now</button></div>
    <h2>App</h2>
    <p id="sh-version" class="muted small"></p>
    ${latestRelease ? `<p>Update available: <b>${esc(latestRelease.name)}</b></p>
      <div class="sheet-actions"><button class="btn primary" id="sh-download">Download update</button></div>` : ""}
    <div class="sheet-actions"><button class="btn" id="sh-check">Check for updates</button></div>
    <p class="muted small">Rates by <a href="#" data-url="https://www.exchangerate-api.com">Exchange Rate API</a>,
    <a href="#" data-url="https://www.coinbase.com">Coinbase</a> and
    <a href="#" data-url="https://github.com/fawazahmed0/exchange-api">fawazahmed0/exchange-api</a>.</p>
  `);
  $("sh-refresh").onclick = () => { closeSheet(); refresh(true); };
  $("sh-check").onclick = (e) => {
    e.target.disabled = true;
    e.target.textContent = "Checking…";
    checkForUpdate(true)
      .then((rel) => { if (!rel) toast("You're on the latest version."); showStatus(); })
      .catch(() => { toast("Couldn't check for updates."); e.target.disabled = false; e.target.textContent = "Check for updates"; });
  };
  if ($("sh-download")) $("sh-download").onclick = () => Native.openUrl(latestRelease.url);
  $("sheet").querySelectorAll("[data-url]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); Native.openUrl(a.dataset.url); }));
  if (Native.available) Native.appInfo().then((i) => { if ($("sh-version")) $("sh-version").textContent = `Version ${i.versionName}`; }).catch(() => {});
  else $("sh-version").textContent = "Web version";
}
$("status").addEventListener("click", showStatus);

function showCurrency(code) {
  const c = BY_CODE[code];
  const info = market.info[code];
  const v = amountIn(code);
  const cand = info ? info.candidates.map((k) => {
    const used = k.src === info.src;
    return `<li class="${used ? "used" : ""}"><b>${esc(Rates.SOURCES[k.src].name)}</b>: 1 USD = ${esc(Format.rate(k.rate))} ${code}
      <br><span class="muted">${Format.age(k.at)}${used ? " · used" : ""}</span></li>`;
  }).join("") : "";
  const verdict = !info ? "No source has a rate for this currency."
    : info.status === "verified" ? "Sources agree."
    : info.status === "single" ? "Only one source has this currency, so it can't be cross-checked."
    : "⚠ The sources disagree by more than the usual daily move. Check before relying on this rate.";
  openSheet(`
    <h2>${flag(code)} ${code} · ${esc(c.name)}</h2>
    ${code !== state.active && Number.isFinite(v) ? `<p class="big">${esc(Format.amount(v))} ${code}</p>
      <p class="muted">${esc(Format.expression(state.expr))} ${state.active}</p>` : ""}
    <p class="${info && info.status === "disputed" ? "warn-text" : "muted small"}">${verdict}</p>
    <ul class="sources">${cand}</ul>
    <div class="sheet-actions">
      ${Number.isFinite(v) ? '<button class="btn" id="sh-copy">Copy amount</button>' : ""}
      <button class="btn" id="sh-remove">Remove</button>
    </div>
  `);
  if ($("sh-copy")) $("sh-copy").onclick = () => {
    const text = code === state.active ? Calc.toPlain(activeAmount()) : String(shownValue(v));
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast(`Copied ${text}`)).catch(() => toast("Couldn't copy"));
  };
  $("sh-remove").onclick = () => {
    state.list = state.list.filter((x) => x !== code);
    if (state.active === code && state.list.length) { state.active = state.list[0]; state.expr = "1"; state.fresh = true; }
    saveState();
    closeSheet();
    render();
  };
}

// ─── Picker ────────────────────────────────────────────────────────────────

const searchText = (c) => (c.code + " " + c.name + " " + (c.region ? regionName(c.region) : "")).toLowerCase();
let regionNames = null;
function regionName(r) {
  try {
    regionNames = regionNames || new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(r) || "";
  } catch { return ""; }
}

function pickerItem(c) {
  const on = state.list.includes(c.code);
  const hasRate = market.rates[c.code] !== undefined;
  return `<button class="pick${on ? " on" : ""}" data-code="${c.code}">
    <span class="flag ${c.kind}">${flag(c.code)}</span>
    <span class="ident"><span class="code">${c.code}</span><span class="name">${esc(c.name)}${hasRate ? "" : " · no rate yet"}</span></span>
    <span class="check">${on ? "✓" : "+"}</span>
  </button>`;
}

function renderPicker() {
  const q = $("search").value.trim().toLowerCase();
  let html;
  if (q) {
    const hits = ALL.filter((c) => searchText(c).includes(q))
      .sort((a, b) => (b.code.toLowerCase().startsWith(q) - a.code.toLowerCase().startsWith(q)) || a.code.localeCompare(b.code));
    html = hits.length ? hits.map(pickerItem).join("") : '<p class="empty">Nothing matches.</p>';
  } else {
    const section = (title, items) => `<h3>${title}</h3>${items.map(pickerItem).join("")}`;
    html = section("Popular", POPULAR.map((c) => BY_CODE[c])) +
      section("All currencies", ALL.filter((c) => c.kind === "fiat")) +
      section("Crypto", ALL.filter((c) => c.kind === "crypto")) +
      section("Precious metals", ALL.filter((c) => c.kind === "metal"));
  }
  $("picker-list").innerHTML = html;
}

function openPicker() {
  pickerOpen = true;
  $("picker").hidden = false;
  $("search").value = "";
  renderPicker();
  $("picker-list").scrollTop = 0;
  history.pushState({ picker: true }, "");
}
function closePicker(fromHistory) {
  if (!pickerOpen) return;
  pickerOpen = false;
  $("picker").hidden = true;
  $("search").blur();
  if (!fromHistory) history.back();
  render();
}
$("add").addEventListener("click", openPicker);
$("picker-close").addEventListener("click", () => closePicker());
$("search").addEventListener("input", renderPicker);
$("picker-list").addEventListener("click", (e) => {
  const b = e.target.closest(".pick");
  if (!b) return;
  const code = b.dataset.code;
  if (state.list.includes(code)) {
    state.list = state.list.filter((x) => x !== code);
    if (state.active === code && state.list.length) { state.active = state.list[0]; state.expr = "1"; state.fresh = true; }
  } else {
    state.list.push(code);
    if (state.list.length === 1) { state.active = code; state.expr = "1"; state.fresh = true; }
  }
  saveState();
  b.outerHTML = pickerItem(BY_CODE[code]);
});

// ─── App updates (GitHub releases, like the running app) ───────────────────

function checkForUpdate(force = false) {
  if (!Native.available) return Promise.resolve(null);
  const last = Number(localStorage.getItem(UPDATE_KEY)) || 0;
  if (!force && Date.now() - last < UPDATE_CHECK_MS) return Promise.resolve(latestRelease);
  return Promise.all([
    Native.appInfo(),
    fetchText(`https://api.github.com/repos/${REPO}/releases/latest`).then(JSON.parse),
  ]).then(([app, rel]) => {
    try { localStorage.setItem(UPDATE_KEY, String(Date.now())); } catch { /* storage full */ }
    const code = Number((/(\d+)$/.exec(rel.tag_name || "") || [])[1]);
    const apk = (rel.assets || []).find((a) => /\.apk$/.test(a.name));
    latestRelease = apk && code > app.versionCode ? { name: rel.name || rel.tag_name, url: apk.browser_download_url } : null;
    if (latestRelease && !force) toast(`Update available: ${latestRelease.name}. Tap the rate status to get it.`, 5000);
    renderStatus();
    return latestRelease;
  });
}

// ─── Toast ─────────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(text, ms = 2500) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ─── Start ─────────────────────────────────────────────────────────────────

$("decimal-key").textContent = Format.decimalMark();
recompute();
render();
fetch("snapshot.json")
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}))
  .then((snap) => { bundled = snap || {}; recompute(); render(); })
  .then(() => refresh())
  .then(() => setTimeout(() => checkForUpdate().catch(() => {}), 3000));
})();
