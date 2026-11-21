package com.gdhameeja.currencyconverter;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The latest raw response of each rate source, as text with the time it was
 * fetched. Written by {@link RatesWorker} in the background and read by the
 * page through {@link RatesPlugin}; rates.js does all parsing and checking, so
 * this side only has to make sure a response looks like the right document.
 * The URLs must match SOURCES in rates.js.
 */
final class RatesStore {
    static final String[] SOURCES = {"coinbase", "er", "fw"};

    static String[] urls(String src) {
        switch (src) {
            case "coinbase":
                return new String[] {"https://api.coinbase.com/v2/exchange-rates?currency=USD"};
            case "er":
                return new String[] {"https://open.er-api.com/v6/latest/USD"};
            case "fw":
                return new String[] {
                    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
                    "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
                };
            default:
                return new String[0];
        }
    }

    /** A cheap check that the body is the document we asked for, not an error page. */
    static boolean looksValid(String src, String body) {
        if (body == null || body.length() < 200 || !body.trim().startsWith("{")) return false;
        switch (src) {
            case "coinbase":
                return body.contains("\"currency\":\"USD\"");
            case "er":
                return body.contains("\"result\":\"success\"");
            case "fw":
                return body.contains("\"usd\"");
            default:
                return false;
        }
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("rates", Context.MODE_PRIVATE);
    }

    static void put(Context c, String src, String text, long fetchedAt) {
        prefs(c).edit().putString(src + ".text", text).putLong(src + ".at", fetchedAt).apply();
    }

    static String text(Context c, String src) {
        return prefs(c).getString(src + ".text", null);
    }

    static long fetchedAt(Context c, String src) {
        return prefs(c).getLong(src + ".at", 0);
    }

    private RatesStore() {}
}
