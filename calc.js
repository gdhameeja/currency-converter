// The keypad's expression: typing rules and evaluation. No eval().
// Expressions are strings of numbers and the operators + − × ÷ and %, e.g. "1,200" is
// stored as "1200", "12.5×3+10%". Percent follows calculator habit:
// a+b% = a + a·b/100, a−b% = a − a·b/100, a×b% = a·b/100, a÷b% = a ÷ (b/100), b% alone = b/100.
(function (root) {
const OPS = ["+", "−", "×", "÷"];
const MAX_DIGITS = 15;

const isOp = (ch) => OPS.includes(ch);
const lastNumber = (expr) => {
  const m = /[0-9.]*%?$/.exec(expr);
  return m ? m[0] : "";
};

// Applies one key to the expression. `fresh` means the expression is a value
// carried over (from another row or "="): a digit replaces it, an operator continues it.
function press(expr, key, fresh) {
  if (key === "C") return "";
  if (key === "⌫") return fresh ? "" : expr.slice(0, -1);
  if (key === "=") {
    const plain = toPlain(evaluate(expr));
    return plain === null ? expr : plain;
  }
  if (/^[0-9]$/.test(key) || key === "00") {
    if (fresh) expr = "";
    const num = lastNumber(expr);
    if (num.endsWith("%")) return expr; // need an operator after %
    if (num === "" && key === "00") key = "0";
    if (num === "0") return expr.slice(0, -1) + (key === "00" ? "0" : key);
    if (num.replace(".", "").length + key.length > MAX_DIGITS) return expr;
    return expr + key;
  }
  if (key === ".") {
    if (fresh) expr = "";
    const num = lastNumber(expr);
    if (num.includes(".") || num.endsWith("%")) return expr;
    return expr + (num === "" ? "0." : ".");
  }
  if (key === "%") {
    const num = lastNumber(expr);
    if (num === "" || num.endsWith("%") || num === ".") return expr;
    return expr + "%";
  }
  if (isOp(key)) {
    if (expr === "") return expr;
    const last = expr.slice(-1);
    if (isOp(last)) return expr.slice(0, -1) + key;
    if (last === ".") expr = expr.slice(0, -1);
    return expr + key;
  }
  return expr;
}

// Tokens: [number, percent?] and operators. Incomplete endings ("12+", "3.") are ignored.
function tokenize(expr) {
  const tokens = [];
  const re = /([0-9]*\.?[0-9]*)(%?)([+−×÷]?)/y;
  let i = 0;
  while (i < expr.length) {
    re.lastIndex = i;
    const m = re.exec(expr);
    if (!m || m[0] === "") return null;
    if (m[1] === "" || m[1] === ".") return null;
    tokens.push({ n: Number(m[1]), pct: m[2] === "%" });
    if (m[3]) tokens.push(m[3]);
    i = re.lastIndex;
  }
  if (isOp(tokens[tokens.length - 1])) tokens.pop();
  return tokens;
}

// NaN for an empty or invalid expression; Infinity for ÷0
function evaluate(expr) {
  if (!expr) return NaN;
  const t = tokenize(expr);
  if (!t || t.length === 0) return NaN;
  // Multiplication and division first, into terms joined by + and −
  const terms = []; // [{ sign, value, pct }]: pct terms of + and − are relative to the running total
  let sign = 1;
  let cur = null; // { value, pct }
  for (let i = 0; i < t.length; i += 2) {
    const { n, pct } = t[i];
    const op = i > 0 ? t[i - 1] : null;
    if (op === "×" || op === "÷") {
      const v = pct ? n / 100 : n;
      cur = { value: op === "×" ? cur.value * v : cur.value / v, pct: false };
    } else {
      if (cur) terms.push({ sign, ...cur });
      sign = op === "−" ? -1 : 1;
      cur = { value: n, pct };
    }
  }
  terms.push({ sign, ...cur });
  let total = 0;
  terms.forEach((term, idx) => {
    if (term.pct && idx === 0) total = term.value / 100;
    else if (term.pct) total += term.sign * total * (term.value / 100);
    else total += term.sign * term.value;
  });
  return round(total);
}

// Hides floating-point noise: 0.1+0.2 -> 0.3
function round(v) {
  if (!Number.isFinite(v) || v === 0) return v;
  return Number(v.toPrecision(14));
}

// A number as an expression the keypad can keep editing (no exponent, no
// grouping), or null when it can't be one: negative, infinite, or too long.
// Decimals beyond MAX_DIGITS are dropped; whole digits never are.
function toPlain(v) {
  if (!Number.isFinite(v) || v < 0) return null;
  v = round(v);
  // String() gives the shortest form ("123456789012.12"); toFixed only for the exponent form of tiny numbers
  let s = String(v);
  if (s.includes("e")) s = v.toFixed(10).replace(/\.?0+$/, "");
  const whole = s.split(".")[0];
  if (whole.length > MAX_DIGITS) return null;
  if (s.replace(".", "").length > MAX_DIGITS) s = s.slice(0, MAX_DIGITS + 1).replace(/\.?0*$/, "");
  return s === "" ? "0" : s;
}

const hasOperator = (expr) => /[+−×÷%]/.test(expr);

const api = { press, evaluate, toPlain, hasOperator, tokenize, OPS };
if (typeof module !== "undefined") module.exports = api;
else root.Calc = api;
})(this);
