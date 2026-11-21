// Copies the web app into www/, which Capacitor bundles into the Android app,
// with a snapshot of today's rates so a fresh install works offline from the
// start. If the sources can't be reached, the last snapshot (data/snapshot.json) is used.
const fs = require("fs");
const path = require("path");
const Rates = require("../rates.js");

const root = path.join(__dirname, "..");
const out = path.join(root, "www");
const snapshotFile = path.join(root, "data", "snapshot.json");
const files = ["index.html", "styles.css", "currencies.js", "rates.js", "calc.js", "format.js", "native.js", "app.js"];

async function fetchSource(src) {
  for (const url of Rates.SOURCES[src].urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const raw = { text: await r.text(), fetchedAt: Date.now() };
      if (Rates.parse(src, raw)) return raw;
    } catch { /* next url */ }
  }
  return null;
}

async function snapshot() {
  let old = {};
  try { old = JSON.parse(fs.readFileSync(snapshotFile, "utf8")); } catch { /* none yet */ }
  if (process.env.OFFLINE_BUILD) return old;
  const fresh = {};
  for (const src of Object.keys(Rates.SOURCES)) {
    const raw = await fetchSource(src);
    if (raw) fresh[src] = raw;
    console.log(`${src}: ${raw ? "fetched" : "unavailable, keeping the saved copy"}`);
  }
  const merged = Rates.combineStores(old, fresh);
  fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
  fs.writeFileSync(snapshotFile, JSON.stringify(merged));
  return merged;
}

(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out);
  for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
  const snap = await snapshot();
  if (!Object.keys(snap).length) throw new Error("No rate snapshot: build once with internet access");
  fs.writeFileSync(path.join(out, "snapshot.json"), JSON.stringify(snap));
  console.log(`Copied ${files.length} files and a snapshot of ${Object.keys(snap).join(", ")} to www/`);
})().catch((e) => { console.error(e.message); process.exit(1); });
