package com.lisitsa.misterlapkins;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Android can silently defer or drop this app's scheduled task reminders (AlarmManager-based via
// @capacitor/local-notifications) while it's backgrounded, unless the user has told the OS not to
// battery-optimize it — on top of that, several OEMs (MIUI, EMUI, etc.) layer their own even more
// aggressive background killers on top of stock Android. There's no ready-made Capacitor plugin
// for the standard ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS system dialog, so this is a small
// local one. See window.AppBattery in src/battery.js and the one-time hint modal in index.html
// (openBatteryHint) for where this actually gets surfaced to the user.
@CapacitorPlugin(name = "BatteryOptimization")
public class BatteryOptimizationPlugin extends Plugin {

    @PluginMethod
    public void isIgnoringOptimizations(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            result.put("ignoring", powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        } else {
            result.put("ignoring", true); // battery optimization didn't exist before Marshmallow
        }
        call.resolve(result);
    }

    // Opens the OS's own "Allow [app] to ignore battery optimizations?" dialog directly — a
    // single tap for the user, rather than sending them to hunt through Settings themselves.
    @PluginMethod
    public void requestIgnoreOptimizations(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        }
        call.resolve();
    }
}
