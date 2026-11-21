package com.gdhameeja.currencyconverter;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The page's side of things: see native.js. */
@CapacitorPlugin(name = "Rates")
public class RatesPlugin extends Plugin {

    /** Resolves with { store: { coinbase: { text, fetchedAt }, er: ..., fw: ... } }, sources missing if never fetched. */
    @PluginMethod
    public void stored(PluginCall call) {
        JSObject store = new JSObject();
        for (String src : RatesStore.SOURCES) {
            String text = RatesStore.text(getContext(), src);
            if (text == null) continue;
            JSObject raw = new JSObject();
            raw.put("text", text);
            raw.put("fetchedAt", RatesStore.fetchedAt(getContext(), src));
            store.put(src, raw);
        }
        JSObject result = new JSObject();
        result.put("store", store);
        call.resolve(result);
    }

    /** Resolves with { versionCode, versionName } of the installed app. */
    @PluginMethod
    public void appInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            @SuppressWarnings("deprecation")
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            JSObject result = new JSObject();
            result.put("versionCode", code);
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("No package info: " + e);
        }
    }

    /** Opens a link in the browser (the APK download for an update). */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://"))) {
            call.reject("Only https links");
            return;
        }
        try {
            getContext().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open " + url);
        }
    }
}
