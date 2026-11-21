// Run with `npm test`. Plain Node, no test framework.
// Rate fixtures in test/fixtures are real responses from 21 Nov 2026.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Calc = require("./calc.js");
const Rates = require("./rates.js");
const Format = require("./format.js");
const Currencies = require("./currencies.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); }
}
const near = (a, b, rel = 1e-9) => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, `${a} ≉ ${b}`);
const fixture = (f) => fs.readFileSync(path.join(__dirname, "test/fixtures", f), "utf8");
const FETCHED = Date.parse("2026-11-21T01:38:40Z");
const raw = {
  coinbase: { text: fixture("coinbase.json"), fetchedAt: FETCHED },
  er: { text: fixture("er.json"), fetchedAt: FETCHED },
  fw: { text: fixture("fw.json"), fetchedAt: FETCHED },
};
const typed = (keys, start = "", fresh = false) => keys.reduce((e, k, i) => Calc.press(e, k, fresh && i === 0), start);

// ─── Calculator ────────────────────────────────────────────────────────────

test("digits and decimal point", () => {
  assert.strictEqual(typed(["1", "2", ".", "5"]), "12.5");
  assert.strictEqual(typed([".", "5"]), "0.5");
  assert.strictEqual(typed(["1", ".", ".", "2"]), "1.2");
  assert.strictEqual(typed(["0", "0", "7"]), "7");
  assert.strictEqual(typed(["00"]), "0");
  assert.strictEqual(typed(["5", "00"]), "500");
});

test("operators replace each other and need a number first", () => {
  assert.strictEqual(typed(["+"]), "");
  assert.strictEqual(typed(["5", "+", "×"]), "5×");
  assert.strictEqual(typed(["5", ".", "+"]), "5+");
});

test("a fresh value is replaced by a digit, continued by an operator", () => {
  assert.strictEqual(Calc.press("92.64", "3", true), "3");
  assert.strictEqual(Calc.press("92.64", ".", true), "0.");
  assert.strictEqual(Calc.press("92.64", "+", true), "92.64+");
  assert.strictEqual(Calc.press("92.64", "⌫", true), "");
  assert.strictEqual(Calc.press("92.64", "⌫", false), "92.6");
});

test("evaluation order and percent", () => {
  assert.strictEqual(Calc.evaluate("2+3×4"), 14);
  assert.strictEqual(Calc.evaluate("10−4÷2"), 8);
  assert.strictEqual(Calc.evaluate("200+10%"), 220);
  assert.strictEqual(Calc.evaluate("200−10%"), 180);
  assert.strictEqual(Calc.evaluate("200×10%"), 20);
  assert.strictEqual(Calc.evaluate("50%"), 0.5);
  assert.strictEqual(Calc.evaluate("0.1+0.2"), 0.3);
  assert.strictEqual(Calc.evaluate("12+"), 12);
  assert.strictEqual(Calc.evaluate("3."), 3);
  assert.ok(Number.isNaN(Calc.evaluate("")));
  assert.strictEqual(Calc.evaluate("1÷0"), Infinity);
});

test("= keeps the result editable, and leaves impossible results alone", () => {
  assert.strictEqual(Calc.press("2+3×4", "="), "14");
  assert.strictEqual(Calc.press("1÷3", "="), "0.33333333333333");
  assert.strictEqual(Calc.press("1÷0", "="), "1÷0");
  assert.strictEqual(Calc.press("5−10", "="), "5−10");
  assert.strictEqual(Calc.toPlain(1e20), null);
  assert.strictEqual(Calc.toPlain(123456789012.123456), "123456789012.12");
  assert.strictEqual(Calc.evaluate("1.1×3"), 3.3);
  assert.strictEqual(Calc.evaluate("99999999.99+0.01"), 100000000);
});

test("digit limit", () => {
  const e = typed(Array(20).fill("9"));
  assert.strictEqual(e.length, 15);
});

// ─── Rates ─────────────────────────────────────────────────────────────────

const parsed = Object.keys(Rates.SOURCES).map((s) => Rates.parse(s, raw[s]));
const market = Rates.merge(parsed, Currencies.ALL);

test("all three fixtures parse", () => {
  parsed.forEach((p, i) => assert.ok(p, Object.keys(Rates.SOURCES)[i]));
  assert.strictEqual(parsed[0].at, FETCHED);
  assert.strictEqual(parsed[1].at, Date.parse("Fri, 20 Nov 2026 00:02:32 +0000"));
  assert.strictEqual(parsed[2].at, Date.parse("2026-11-20T00:00:00Z"));
});

test("broken responses are rejected", () => {
  assert.strictEqual(Rates.parse("coinbase", { text: "<html>", fetchedAt: 1 }), null);
  assert.strictEqual(Rates.parse("er", { text: '{"result":"error"}', fetchedAt: 1 }), null);
  assert.strictEqual(Rates.parse("fw", { text: '{"date":"2026-01-01","usd":{"eur":0.9}}', fetchedAt: 1 }), null); // too few
  const badEur = JSON.parse(raw.er.text);
  badEur.rates.EUR = 92;
  assert.strictEqual(Rates.parse("er", { text: JSON.stringify(badEur) }), null);
  assert.strictEqual(Rates.parse("er", null), null);
});

test("live rate is used when a daily source agrees", () => {
  for (const c of ["INR", "EUR", "GBP", "JPY", "AED", "CAD", "CHF"]) {
    assert.strictEqual(market.info[c].src, "coinbase", c);
    assert.strictEqual(market.info[c].status, "verified", c);
  }
  near(market.rates.INR, 92.64383);
});

test("Coinbase's wrong rates are outvoted by the daily sources", () => {
  // Coinbase said ERN 344.29 (it's pegged at 15), SSP 130 (~5800), MNT 2623 (~3605)
  for (const [c, lo, hi] of [["ERN", 14.9, 15.1], ["SSP", 5700, 5900], ["MNT", 3590, 3620]]) {
    assert.notStrictEqual(market.info[c].src, "coinbase", c);
    assert.strictEqual(market.info[c].status, "verified", c);
    assert.ok(market.rates[c] > lo && market.rates[c] < hi, `${c} ${market.rates[c]}`);
  }
});

test("no agreement at all is reported as disputed", () => {
  // SYP: 512.8 / 121.7 / 12992.6
  assert.strictEqual(market.info.SYP.status, "disputed");
  assert.strictEqual(market.info.SYP.candidates.length, 3);
});

test("crypto comes from Coinbase live, metals from the daily source", () => {
  assert.strictEqual(market.info.BTC.src, "coinbase");
  assert.strictEqual(market.info.TRX.src, "fw"); // Coinbase doesn't list TRX
  assert.strictEqual(market.info.TRX.status, "single");
  assert.strictEqual(market.info.XAU.src, "fw");
  near(1 / market.rates.XAU, 1 / 0.0002816559);
});

test("every currency offered has a rate", () => {
  const missing = Currencies.ALL.filter((c) => market.rates[c.code] === undefined).map((c) => c.code);
  assert.deepStrictEqual(missing, []);
});

test("conversion goes through USD", () => {
  near(Rates.convert(1, "USD", "INR", market.rates), 92.64383);
  near(Rates.convert(92.64383, "INR", "USD", market.rates), 1);
  near(Rates.convert(100, "EUR", "INR", market.rates), (100 / market.rates.EUR) * market.rates.INR);
  assert.strictEqual(Rates.convert(1, "USD", "USD", market.rates), 1);
  assert.ok(Number.isNaN(Rates.convert(1, "USD", "XXX", market.rates)));
});

test("with only daily sources (offline with old data), rates still come out", () => {
  const m = Rates.merge([parsed[1], parsed[2]], Currencies.ALL);
  assert.strictEqual(m.info.INR.status, "verified");
  assert.strictEqual(m.info.INR.src, "er"); // er's timestamp is 2 minutes after fw's
  const only = Rates.merge([parsed[1]], Currencies.ALL);
  assert.strictEqual(only.info.INR.status, "single");
});

test("a stale live copy loses to fresher daily data that agrees", () => {
  const oldLive = Rates.parse("coinbase", { text: raw.coinbase.text, fetchedAt: Date.parse("2026-11-10T00:00:00Z") });
  const m = Rates.merge([oldLive, parsed[1], parsed[2]], Currencies.ALL);
  assert.strictEqual(m.info.EUR.src, "er");
});

test("decide(): ties and tolerance", () => {
  const d = Rates.decide([{ src: "coinbase", rate: 100, at: 3 }, { src: "er", rate: 104, at: 2 }, { src: "fw", rate: 200, at: 1 }], "fiat");
  assert.strictEqual(d.src, "coinbase");
  assert.strictEqual(d.status, "verified");
  const two = Rates.decide([{ src: "coinbase", rate: 100, at: 3 }, { src: "er", rate: 120, at: 2 }], "fiat");
  assert.strictEqual(two.status, "disputed");
  assert.strictEqual(two.src, "er");
  const crypto = Rates.decide([{ src: "coinbase", rate: 100, at: 3 }, { src: "fw", rate: 120, at: 2 }], "crypto");
  assert.strictEqual(crypto.src, "coinbase");
});

test("combineStores keeps the newest valid copy of each source", () => {
  const older = { coinbase: { text: raw.coinbase.text, fetchedAt: FETCHED - 1000 } };
  const broken = { coinbase: { text: "oops", fetchedAt: FETCHED + 1000 } };
  const s = Rates.combineStores(older, { coinbase: raw.coinbase }, broken, { er: raw.er });
  assert.strictEqual(s.coinbase.fetchedAt, FETCHED);
  assert.ok(s.er);
  assert.ok(!s.fw);
  assert.deepStrictEqual(Rates.combineStores({}, null, undefined), {});
});

// ─── Formatting ────────────────────────────────────────────────────────────

test("amounts", () => {
  Format.setLocale("en-US");
  assert.strictEqual(Format.amount(9264.3834), "9,264.38");
  assert.strictEqual(Format.amount(0.010794), "0.01079");
  assert.strictEqual(Format.amount(0.0000170080725), "0.00001701");
  assert.strictEqual(Format.amount(0), "0");
  assert.strictEqual(Format.amount(NaN), "—");
  assert.strictEqual(Format.rate(92.64383), "92.6438");
  assert.strictEqual(Format.rate(1573.92652), "1,573.93");
  Format.setLocale("en-IN");
  assert.strictEqual(Format.amount(1234567.891), "12,34,567.89");
  Format.setLocale("de-DE");
  assert.strictEqual(Format.amount(1234.5), "1.234,50");
  assert.strictEqual(Format.expression("1234.5+2"), "1.234,5 + 2");
  Format.setLocale("en-US");
});

test("expression display keeps what was typed", () => {
  assert.strictEqual(Format.expression(""), "0");
  assert.strictEqual(Format.expression("0."), "0.");
  assert.strictEqual(Format.expression("1250000.50×3"), "1,250,000.50 × 3");
  assert.strictEqual(Format.expression("10%"), "10%");
});

test("ages", () => {
  const now = 1e12;
  assert.strictEqual(Format.age(now - 10e3, now), "just now");
  assert.strictEqual(Format.age(now - 5 * 60e3, now), "5 min ago");
  assert.strictEqual(Format.age(now - 3 * 3600e3, now), "3 h ago");
  assert.strictEqual(Format.age(now - 3 * 86400e3, now), "3 days ago");
});

// ─── Currency list ─────────────────────────────────────────────────────────

test("currency list has no duplicates and valid flags", () => {
  const codes = Currencies.ALL.map((c) => c.code);
  assert.strictEqual(new Set(codes).size, codes.length);
  for (const c of Currencies.ALL) if (c.kind === "fiat" && c.region) assert.ok(/^[A-Z]{2}$/.test(c.region), c.code);
  for (const c of Currencies.POPULAR) assert.ok(Currencies.BY_CODE[c], c);
  assert.strictEqual(Currencies.flag("INR"), "🇮🇳");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
