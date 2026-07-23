package com.lisitsa.misterlapkins;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (not npm-published) plugin — must be registered before super.onCreate() per
        // Capacitor's own convention for custom plugins living directly in the app module.
        registerPlugin(BatteryOptimizationPlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor only enables chrome://inspect debugging by default for debug builds — this
        // forces it on for release builds too, so the cloud-sync data-loss bug can actually be
        // observed via real console logs instead of guessing. Fine to remove once that's closed.
        WebView.setWebContentsDebuggingEnabled(true);
    }
}
