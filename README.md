# Converter

An ad-free currency converter for Android: a list of your currencies, type an
amount (or a sum: `100 × 3 + 10%`) in any of them and the rest follow. It
offers 158 currencies, 20 cryptocurrencies, and gold, silver, platinum and
palladium. A vanilla HTML/JS app wrapped in Capacitor, built like the running app.

## Using it

- **Tap** a currency to type in it. **Long-press** it to see each source's rate, copy the amount or remove it.
- **+ Add currency** to search by code, name or country. **Edit** to reorder or remove currencies.
- The pill at the top shows how fresh the rates are: green = live, amber = older, red = more than 3 days old or none.
  Tap it for the details of each source, to refresh, and to check for app updates.

## Where rates come from, and how they're checked

All three are free and need no key. Every rate is quoted per 1 USD:

| Source | Updates | Covers |
|---|---|---|
| Coinbase (`api.coinbase.com/v2/exchange-rates`) | every minute | ~150 fiat currencies + crypto |
| ExchangeRate-API (`open.er-api.com`) | daily | ~165 fiat currencies |
| fawazahmed0 currency-api (jsDelivr, Cloudflare mirror) | daily | fiat + crypto + metals |

These are **mid-market** rates: the rate banks trade at between themselves.
Your bank or card will give you a bit less (their markup), as with any converter.

For every currency the sources vote (`rates.js`):

- A rate is used only when **at least two sources agree** (within 5% for fiat and
  metals, 15% for crypto, which allows one day's move). The freshest of the
  agreeing ones wins, so you get Coinbase's live rate whenever it is confirmed.
- When Coinbase is the odd one out, the daily rate is used. This matters: on
  21 Nov 2026 Coinbase quoted the Eritrean nakfa at 344 per USD (it's pegged at 15),
  and was also far off for the South Sudanese pound and Mongolian tögrög.
- When no two sources agree (the Syrian pound, mid-redenomination), the currency
  gets a ⚠ and long-pressing it shows every source's number.
- A currency only one source has (TRON, the metals) is used as is, with the source marked.

## Offline

Rates are kept on the phone in three ways, newest valid copy wins:

1. Every successful fetch while the app is open (Coinbase every minute, the daily sources every hour).
2. A background job (`RatesWorker.java`, WorkManager) that fetches all three
   roughly every hour whenever the phone has internet, even with the app closed.
   Android may stretch this to save battery.
3. A snapshot bundled into each APK at build time, so a fresh install works with no internet.

Offline, the app shows "Offline · rates from 3 h ago" so you know how old they are.

## Build

Needs only Docker:

    docker/build-apk.sh

This runs the JS tests and Android unit tests, then writes
`android/app/build/outputs/apk/debug/app-debug.apk`. The version is
`1.<commit count>`, so a build of a later commit always installs over an earlier one.

`npm test` runs the JS tests alone (calculator, rate voting against real
responses saved in `test/fixtures/`, formatting).

## Releases (no cable)

Every push to `main` builds the APK on GitHub (`.github/workflows/release.yml`)
and publishes it as a release (`v1.<commit count>`). The app checks for a newer
release when it opens (at most every 6 hours) and shows a blue dot on the rate
pill. Tap it, then **Download update**, and open the downloaded APK.

The repository must be **public**: the app reads the releases without signing in.

The release must be signed with the same key as the app on your phone, or
Android refuses the update. One-time setup, after the first local build has created the key:

    base64 -w0 .android-user/debug.keystore

Copy the output into a repo secret named `DEBUG_KEYSTORE_B64` (**GitHub →
Settings → Secrets and variables → Actions → New repository secret**).
Keep `.android-user/debug.keystore` safe: it's git-ignored, and without it
future updates can't install over the app.

## Files

- `rates.js`: sources, parsing, cross-checking. `currencies.js`: the currency list.
- `calc.js`: keypad and expression evaluation. `format.js`: number display.
- `app.js`, `index.html`, `styles.css`: the screen. `native.js`: bridge to Android.
- `android/app/src/main/java/.../RatesWorker.java`, `RatesStore.java`, `RatesPlugin.java`: background refresh, storage, version info.
- `scripts/build-web.js`: copies the app to `www/` with a fresh rate snapshot (`data/snapshot.json`).
