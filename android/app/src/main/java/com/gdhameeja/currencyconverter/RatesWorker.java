package com.gdhameeja.currencyconverter;

import android.content.Context;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * Fetches the rates about every 12 hours while the phone has internet, even
 * with the app closed, so the rates you see offline are the last ones the
 * phone could get rather than the last ones you happened to open the app for.
 * Android may stretch the interval to save battery (Doze); WorkManager keeps
 * the schedule across reboots. UPDATE (not KEEP) so a changed interval
 * reaches phones that already have the old schedule.
 */
public class RatesWorker extends Worker {
    private static final String TAG = "RatesWorker";
    private static final String WORK_NAME = "rates-refresh";
    private static final int MAX_BYTES = 2 * 1024 * 1024;

    public RatesWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(RatesWorker.class, 12, TimeUnit.HOURS)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    @NonNull
    @Override
    public Result doWork() {
        int ok = 0;
        for (String src : RatesStore.SOURCES) {
            for (String url : RatesStore.urls(src)) {
                String body = get(url);
                if (RatesStore.looksValid(src, body)) {
                    RatesStore.put(getApplicationContext(), src, body, System.currentTimeMillis());
                    ok++;
                    break;
                }
            }
        }
        Log.i(TAG, "Fetched " + ok + " of " + RatesStore.SOURCES.length + " sources");
        return ok > 0 ? Result.success() : Result.retry();
    }

    private static String get(String address) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(address).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setUseCaches(false);
            conn.setRequestProperty("Accept", "application/json");
            if (conn.getResponseCode() != 200) return null;
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > MAX_BYTES) return null;
                }
                return out.toString(StandardCharsets.UTF_8.name());
            }
        } catch (Exception e) {
            Log.w(TAG, "Couldn't fetch " + address + ": " + e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
