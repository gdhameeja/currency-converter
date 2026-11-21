// Exchange rates: where they come from, how they're checked, and which one wins.
//
// Three free sources, no keys, all quoted as units per 1 USD:
//   coinbase  live (updates every minute), ~150 fiat + crypto. Wrong for a few
//             exotic currencies (ERN, SSP, MNT, SYP were off by 25-2000% when
//             this was written), so it is never trusted on its own.
//   er        open.er-api.com, updated once a day, ~165 fiat
//   fw        fawazahmed0/currency-api, updated once a day, fiat + crypto + metals
//
// For every currency the sources vote: a rate counts as verified when at
// least two sources agree within a tolerance, and the freshest of those that
// agree is used. That way Coinbase's live rate is used whenever it agrees with
// a daily source, and dropped when it doesn't. When no two sources agree, the
// currency is marked "disputed" and the UI says so.
//
// Raw responses are kept as text ({ text, fetchedAt }) so the same parsing
// runs on what the page fetched, what the Android background job fetched,
// and the snapshot bundled into the app.
(function (root) {
const SOURCES = {
  coinbase: {
    name: "Coinbase",
    urls: ["https://api.coinbase.com/v2/exchange-rates?currency=USD"],
    live: true,
  },
  er: {
    name: "ExchangeRate-API",
    urls: ["https://open.er-api.com/v6/latest/USD"],
    live: false,
  },
  fw: {
    name: "fawazahmed0 currency-api",
    urls: [
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
      "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
    ],
    live: false,
  },
};

// How far two sources may differ and still "agree". Daily sources can be up
// to a day behind the live one, so this allows a normal day's move. Crypto
// moves more in a day than fiat.
const TOLERANCE = { fiat: 0.05, metal: 0.05, crypto: 0.15 };

// When nobody agrees, whose number to show (and warn about)
const DISPUTED_ORDER = { fiat: ["er", "fw", "coinbase"], metal: ["fw", "er", "coinbase"], crypto: ["coinbase", "fw", "er"] };

function cleanRates(obj, upper) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) out[upper ? k.toUpperCase() : k] = n;
  }
  return out;
}

// A source whose USD isn't 1, or whose euro is wildly off, is broken as a whole
function sane(rates) {
  if (Math.abs((rates.USD ?? 1) - 1) > 1e-9) return false;
  const eur = rates.EUR;
  return typeof eur === "number" && eur > 0.3 && eur < 3 && Object.keys(rates).length >= 20;
}

// Returns { src, at, rates } or null. `at` is when the rates were true:
// fetch time for the live source, the publisher's timestamp for daily ones.
function parse(src, raw) {
  if (!raw || typeof raw.text !== "string") return null;
  let j;
  try { j = JSON.parse(raw.text); } catch { return null; }
  let rates, at;
  if (src === "coinbase") {
    if (!j || !j.data || j.data.currency !== "USD") return null;
    rates = cleanRates(j.data.rates, true);
    at = raw.fetchedAt;
  } else if (src === "er") {
    if (!j || j.result !== "success" || j.base_code !== "USD") return null;
    rates = cleanRates(j.rates, true);
    at = j.time_last_update_unix * 1000;
  } else if (src === "fw") {
    if (!j || !j.usd || typeof j.date !== "string") return null;
    rates = cleanRates(j.usd, true);
    at = Date.parse(j.date + "T00:00:00Z");
  } else return null;
  if (!Number.isFinite(at) || !sane(rates)) return null;
  rates.USD = 1;
  return { src, at, rates };
}

function agree(a, b, tol) {
  return Math.abs(a / b - 1) <= tol;
}

// candidates: [{ src, rate, at }] for one currency
function decide(candidates, kind) {
  if (candidates.length === 0) return null;
  const tol = TOLERANCE[kind] ?? TOLERANCE.fiat;
  if (candidates.length === 1) return { ...candidates[0], status: "single" };
  // Biggest group of candidates that agree with one of them; ties go to the
  // group with the freshest rate
  let best = null;
  for (const c of candidates) {
    const group = candidates.filter((o) => agree(o.rate, c.rate, tol));
    const freshest = group.reduce((x, y) => (y.at > x.at ? y : x));
    if (!best || group.length > best.group.length || (group.length === best.group.length && freshest.at > best.freshest.at)) {
      best = { group, freshest };
    }
  }
  if (best.group.length >= 2) return { ...best.freshest, status: "verified" };
  const order = DISPUTED_ORDER[kind] ?? DISPUTED_ORDER.fiat;
  const pick = order.map((s) => candidates.find((c) => c.src === s)).find(Boolean);
  return { ...pick, status: "disputed" };
}

// parsed: list of parse() results. currencies: [{ code, kind }].
// Returns { rates: {code: perUSD}, info: {code: {src, at, status, candidates}} }
function merge(parsed, currencies) {
  const rates = {};
  const info = {};
  const ok = parsed.filter(Boolean);
  for (const { code, kind } of currencies) {
    const candidates = ok
      .filter((p) => p.rates[code] !== undefined)
      .map((p) => ({ src: p.src, rate: p.rates[code], at: p.at }));
    const d = decide(candidates, kind);
    if (!d) continue;
    rates[code] = d.rate;
    info[code] = { src: d.src, at: d.at, status: d.status, candidates };
  }
  if (rates.USD !== undefined) {
    rates.USD = 1;
    info.USD.status = "verified";
  }
  return { rates, info };
}

// Of two raw copies of the same source, the one with the newer data
function newerRaw(src, a, b) {
  const pa = parse(src, a), pb = parse(src, b);
  if (!pa) return pb ? b : null;
  if (!pb) return a;
  return pb.at > pa.at ? b : a;
}

// Combine stores ({coinbase: raw, er: raw, fw: raw}), keeping the newest valid copy of each source
function combineStores(...stores) {
  const out = {};
  for (const src of Object.keys(SOURCES)) {
    let best = null;
    for (const s of stores) if (s && s[src]) best = best ? newerRaw(src, best, s[src]) : newerRaw(src, s[src], null);
    if (best) out[src] = best;
  }
  return out;
}

// amount of `from` -> amount of `to`, via USD
function convert(amount, from, to, rates) {
  const rf = rates[from], rt = rates[to];
  if (!rf || !rt) return NaN;
  return (amount / rf) * rt;
}

const api = { SOURCES, TOLERANCE, parse, decide, merge, combineStores, convert };
if (typeof module !== "undefined") module.exports = api;
else root.Rates = api;
})(this);
