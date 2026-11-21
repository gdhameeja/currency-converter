// Bridge to the Android side (RatesPlugin.kt). In a plain browser none of
// this exists and the app runs on what the page fetches itself.
const Native = (() => {
  const cap = window.Capacitor;
  const available = !!(cap && cap.isNativePlatform && cap.isNativePlatform() &&
    (cap.PluginHeaders || []).some((p) => p.name === "Rates"));
  const call = (method, options = {}) => cap.nativePromise("Rates", method, options);
  return {
    available,
    // What the background job fetched: { coinbase: {text, fetchedAt}, er: ..., fw: ... }
    stored: () => (available ? call("stored").then((r) => r.store || {}) : Promise.resolve({})),
    // { versionCode, versionName } of the installed app
    appInfo: () => call("appInfo"),
    openUrl: (url) => (available ? call("openUrl", { url }) : Promise.resolve(window.open(url, "_blank"))),
  };
})();
