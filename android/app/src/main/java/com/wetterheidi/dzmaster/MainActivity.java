package com.wetterheidi.dzmaster;

import android.content.Context;
import android.content.res.Configuration;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

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