package com.wetterheidi.dzmaster;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.WebView;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

import java.io.File;
import java.io.FileWriter;

public class MainActivity extends BridgeActivity {

    private PowerManager.WakeLock wakeLock;
    private boolean isBackground = false;

    // GPS-Pufferdatei: geschrieben von Java wenn JS eingefroren, gelesen von JS beim Aufwachen.
    private static final String GPS_BUFFER_FILE = "gps_buffer.jsonl";
    private static final String GPS_BROADCAST_ACTION =
            "com.equimaps.capacitor_background_geolocation.broadcast";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // WebView-Renderer auf höchste Priorität halten, auch im Hintergrund.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getBridge().getWebView().setRendererPriorityPolicy(
                WebView.RENDERER_PRIORITY_IMPORTANT, false
            );
        }

        requestBatteryOptimizationExemption();

        // Nativer GPS-Puffer: empfängt GPS-Broadcasts vom BackgroundGeolocationService
        // und schreibt jeden Punkt als JSON-Zeile in die Pufferdatei, solange
        // JavaScript eingefroren ist (isBackground = true).
        LocalBroadcastManager.getInstance(this).registerReceiver(
            new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (!isBackground) return;
                    Location location = intent.getParcelableExtra("location");
                    if (location != null) appendToGPSBuffer(location);
                }
            },
            new IntentFilter(GPS_BROADCAST_ACTION)
        );
    }

    /**
     * Fordert den Benutzer einmalig auf, die Akku-Optimierung für diese App
     * zu deaktivieren. Ohne diese Ausnahme kann Android den WebView-Renderer
     * nach kurzer Zeit im Hintergrund einfrieren.
     */
    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
        SharedPreferences prefs = getSharedPreferences("DZMaster", MODE_PRIVATE);
        if (prefs.getBoolean("battery_opt_asked", false)) return;
        prefs.edit().putBoolean("battery_opt_asked", true).apply();
        startActivity(new Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + getPackageName())
        ));
    }

    /**
     * Schreibt einen GPS-Punkt als JSON-Zeile in die Pufferdatei.
     * JavaScript liest diese Datei beim nächsten App-Wakeup und fügt
     * die fehlenden Punkte in den Track ein.
     */
    private void appendToGPSBuffer(Location location) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("lat", location.getLatitude());
            obj.put("lon", location.getLongitude());
            obj.put("alt", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
            obj.put("acc", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
            obj.put("time", location.getTime());
            File file = new File(getFilesDir(), GPS_BUFFER_FILE);
            FileWriter fw = new FileWriter(file, true); // append-Modus
            fw.write(obj.toString() + "\n");
            fw.close();
        } catch (Exception e) {
            // Schreibfehler still ignorieren
        }
    }

    /**
     * Verhindert, dass Capacitor den JavaScript-Thread durch webView.pauseTimers()
     * einfriert. Setzt das isBackground-Flag und acquiriert einen PARTIAL_WAKE_LOCK,
     * damit die CPU wach bleibt.
     */
    @Override
    public void onPause() {
        super.onPause();
        getBridge().getWebView().resumeTimers();
        isBackground = true;

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (wakeLock == null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DZMaster::TrackingWakeLock");
        }
        if (!wakeLock.isHeld()) {
            wakeLock.acquire(4 * 60 * 60 * 1000L); // max. 4 Stunden
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        isBackground = false;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    /**
     * Diese Methode wird vor onCreate() aufgerufen und ist der beste Ort,
     * um die App-Konfiguration zu überschreiben.
     */
    @Override
    protected void attachBaseContext(Context newBase) {
        final Configuration configuration = newBase.getResources().getConfiguration();

        // Setzt die Schrift-Skalierung auf den Standardwert (1.0f) und verhindert,
        // dass die System-Einstellung sie überschreibt.
        if (configuration != null) {
            configuration.fontScale = 1.0f;
        }

        final Context context = newBase.createConfigurationContext(configuration);
        super.attachBaseContext(context);
    }
}
