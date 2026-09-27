package com.lisitsa.misterlapkins;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;

// Bridges src/widgetBridge.js -> the home-screen widget (MrLapkinsWidgetProvider). The widget runs
// as RemoteViews, entirely outside the WebView, so it can't read the app's own localStorage state
// directly — this plugin is the one place that state gets mirrored into native SharedPreferences
// for the widget to read. See the widget plan doc for the full data-flow picture.
//
// Same small-local-plugin pattern as BatteryOptimizationPlugin.java (no dedicated npm wrapper,
// registerPlugin() from @capacitor/core reaches it from src/widgetBridge.js).
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void updateSnapshot(PluginCall call) {
        JSArray tasks = call.getArray("tasks");
        // lists (2026-09-17, replaces the old single "shopping" array) — every shopping list, not
        // just whichever one is active in-app, so a widget instance can be configured to show a
        // different one (see WidgetConfigureActivity/PREF_SELECTED_LIST_PREFIX). activeListId is
        // just the fallback for an unconfigured widget.
        JSArray lists = call.getArray("lists");
        String activeListId = call.getString("activeListId", "");

        SharedPreferences prefs = getContext().getSharedPreferences(MrLapkinsWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(MrLapkinsWidgetProvider.PREF_TASKS_JSON, tasks != null ? tasks.toString() : "[]")
            .putString(MrLapkinsWidgetProvider.PREF_LISTS_JSON, lists != null ? lists.toString() : "[]")
            .putString(MrLapkinsWidgetProvider.PREF_ACTIVE_LIST_ID, activeListId)
            .apply();
        // This snapshot is authoritative — every optimistic checkbox hide from before this point
        // either already shows up as gone here (the app replayed it) or wasn't real, so there's
        // nothing left worth hiding on top of it.
        MrLapkinsWidgetProvider.clearHiddenIds(getContext());

        MrLapkinsWidgetProvider.pushUpdate(getContext());
        call.resolve();
    }

    // Phase 2 (tap-to-check-off) — index.html drains this once on launch/resume and replays each
    // entry through the real toggleTask()/toggleShoppingItem(), so a widget-driven completion goes
    // through the exact same recurrence/reward/Firestore-sync path as an in-app tap. Read-and-clear
    // in one call (not a separate getPendingActions()/clearPendingActions() pair) so there's no
    // window where a checkbox tap between the two calls could get silently dropped.
    @PluginMethod
    public void takePendingActions(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(MrLapkinsWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(MrLapkinsWidgetProvider.PREF_PENDING_ACTIONS_JSON, "[]");
        prefs.edit().remove(MrLapkinsWidgetProvider.PREF_PENDING_ACTIONS_JSON).apply();

        JSObject ret = new JSObject();
        try {
            ret.put("actions", new JSONArray(json));
        } catch (Exception e) {
            ret.put("actions", new JSONArray());
        }
        call.resolve(ret);
    }

    // "Добавить виджет" in the sidebar (2026-09-17) — whether AppWidgetManager.requestPinAppWidget()
    // is available at all, both because it's API 26+ and because not every launcher implements the
    // pin-request contract even on supported OS versions.
    @PluginMethod
    public void isPinWidgetSupported(PluginCall call) {
        JSObject ret = new JSObject();
        boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && AppWidgetManager.getInstance(getContext()).isRequestPinAppWidgetSupported();
        ret.put("supported", supported);
        call.resolve(ret);
    }

    // Fires the OS's own "add this widget to your home screen?" confirmation directly for
    // MrLapkinsWidgetProvider, rather than making someone find Mr. Lapkins by hand in the system's
    // general widget picker. The successCallback (3rd param) is what tells us the widget actually
    // got placed — on MIUI specifically there's no dismissable confirmation UI at all (it just adds
    // the widget straight away), so without this someone tapping the button has zero feedback that
    // anything happened at all and would likely just keep tapping it (reported by Kristina,
    // 2026-09-17). See MrLapkinsWidgetProvider.ACTION_PIN_SUCCESS for the actual toast.
    @PluginMethod
    public void requestPinWidget(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                AppWidgetManager manager = AppWidgetManager.getInstance(getContext());
                if (manager.isRequestPinAppWidgetSupported()) {
                    ComponentName provider = new ComponentName(getContext(), MrLapkinsWidgetProvider.class);
                    manager.requestPinAppWidget(provider, null, MrLapkinsWidgetProvider.pinSuccessPendingIntent(getContext()));
                }
            } catch (IllegalStateException e) {
                // "Calling application must have a foreground activity" — the OS's own check for
                // this call specifically, on top of the general permission/support checks above.
                // Should never actually happen from a real tap on this button (the app IS the
                // foreground activity right then), but crashing over it if it somehow does
                // (a stray call racing a screen-off/backgrounding, say) would be a much worse
                // failure mode than the pin request just silently not happening.
                android.util.Log.w("WidgetBridgePlugin", "requestPinAppWidget failed", e);
            }
        }
        call.resolve();
    }
}
