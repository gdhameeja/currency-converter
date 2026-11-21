// Showing numbers: amounts, the expression being typed, rates and ages.
// Grouping and the decimal mark follow the phone's locale (en-IN shows 1,00,000.00).
(function (root) {
let locale = undefined;
let fmtCache = {};
function nf(opts) {
  const key = JSON.stringify(opts);
  return fmtCache[key] || (fmtCache[key] = new Intl.NumberFormat(locale, opts));
}
function setLocale(l) { locale = l; fmtCache = {}; }

function decimalMark() {
  const part = nf({ minimumFractionDigits: 1 }).formatToParts(1.5).find((p) => p.type === "decimal");
  return part ? part.value : ".";
}

// A converted amount: 2 decimals from 1 up; below 1, 4 significant digits
// (0.0108 USD, 0.00001700 BTC), so small amounts don't round to 0.00.
function amount(v) {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1) return nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return nf({ minimumSignificantDigits: 4, maximumSignificantDigits: 4, maximumFractionDigits: 20 }).format(v);
}

// A rate ("1 USD = 92.6438 INR"): 6 significant digits, or 2 decimals from 1,000 up
function rate(v) {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return nf({ maximumSignificantDigits: 6 }).format(v);
}

// The expression as typed, with grouping: "12500.5×3" -> "12,500.5 × 3"
function expression(expr) {
  if (!expr) return "0";
  const dm = decimalMark();
  return expr.replace(/([0-9]*)(\.?)([0-9]*)/g, (m, whole, dot, frac) => {
    if (m === "") return "";
    const w = whole === "" ? (dot ? "0" : "") : nf({ maximumFractionDigits: 0, useGrouping: true }).format(BigInt(whole));
    return w + (dot ? dm : "") + frac;
  }).replace(/([+−×÷])/g, " $1 ");
}

// "just now", "5 min ago", "3 h ago", "2 days ago"
function age(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function dateTime(ms) {
  return new Date(ms).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const api = { amount, rate, expression, age, dateTime, decimalMark, setLocale };
if (typeof module !== "undefined") module.exports = api;
else root.Format = api;
})(this);
