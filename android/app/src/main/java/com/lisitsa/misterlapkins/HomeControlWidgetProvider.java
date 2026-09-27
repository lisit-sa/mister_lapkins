package com.lisitsa.misterlapkins;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

// "Контроль дома" — a second, separate home-screen widget from MrLapkinsWidgetProvider (Дела/
// Покупки), per Kristina's explicit request (2026-09-27) that this NOT become a third tab on that
// one. Shows the on-device appliance checklist (see renderHomeDevices/homeDevices in index.html)
// with a camera-shutter row per device and a "Я дома" reset button.
//
// Data flow mirrors the other widget: WidgetBridgePlugin.updateHomeControlSnapshot() (called from
// src/widgetBridge.js, itself called from updateHomeControlWidgetSnapshot() in index.html whenever
// renderHomeDevices() runs) writes the device list into its OWN SharedPreferences file (kept
// separate from MrLapkinsWidgetProvider's — different widget, different concern, no reason to
// share one prefs file) and calls pushUpdate() here. HomeControlListService reads that JSON and
// turns it into rows.
//
// Important: checked/photos live only in this device's IndexedDB (never synced — see
// normalizeDevice's own comment in index.html), so this widget's data is inherently per-device
// too, same as the in-app "Контроль дома" tab already is.
public class HomeControlWidgetProvider extends AppWidgetProvider {

    static final String PREFS_NAME = "mr_lapkins_home_control_prefs";
    static final String PREF_DEVICES_JSON = "devices_json";

    // Row tap — opens the camera for that specific device (see handleRowClick). A broadcast
    // template (not straight to MainActivity) so the click's fillInIntent extras (the device id)
    // reach code here first, which then builds the actual deep link.
    private static final String ACTION_ROW_CLICK = "com.lisitsa.misterlapkins.widget.homecontrol.ROW_CLICK";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidgetInstance(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (!ACTION_ROW_CLICK.equals(intent.getAction())) return;
        String deviceId = intent.getStringExtra("deviceId");
        if (deviceId == null || deviceId.length() == 0) return;

        Intent openIntent = new Intent(Intent.ACTION_VIEW,
            Uri.parse("misterlapkins://open?action=device-camera&id=" + Uri.encode(deviceId)));
        openIntent.setPackage(context.getPackageName());
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(openIntent);
    }

    // Called from WidgetBridgePlugin.updateHomeControlSnapshot() whenever the app saves a device
    // change (check, photo, reset, add, delete) — the "instant" refresh path, same reasoning as
    // MrLapkinsWidgetProvider.pushUpdate.
    static void pushUpdate(Context context) {
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        ComponentName componentName = new ComponentName(context, HomeControlWidgetProvider.class);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(componentName);
        for (int appWidgetId : appWidgetIds) {
            updateAppWidgetInstance(context, appWidgetManager, appWidgetId);
        }
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.home_control_list);
    }

    private static void updateAppWidgetInstance(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_home_control);

        Intent adapterIntent = new Intent(context, HomeControlListService.class);
        adapterIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        // setData() with a unique-per-widget URI — same reason as MrLapkinsWidgetProvider's
        // listAdapterIntent: Intent equality for setRemoteAdapter purposes is filter-based, not
        // extras-based, so without this every instance's adapter Intent looks identical.
        adapterIntent.setData(Uri.parse("widget://" + context.getPackageName() + "/homecontrol/" + appWidgetId));
        views.setRemoteAdapter(R.id.home_control_list, adapterIntent);
        views.setEmptyView(R.id.home_control_list, R.id.home_control_empty);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        Intent rowClickIntent = new Intent(context, HomeControlWidgetProvider.class);
        rowClickIntent.setAction(ACTION_ROW_CLICK);
        // FLAG_MUTABLE, NOT FLAG_IMMUTABLE — see MrLapkinsWidgetProvider's own comment on the exact
        // same mistake there: the fillInIntent merge that carries each row's deviceId needs the
        // template to be mutable, or Android 12+ silently drops the merge and every tap arrives
        // with deviceId == null.
        PendingIntent rowClickPendingIntent = PendingIntent.getBroadcast(context, appWidgetId * 100 + 1, rowClickIntent, flags);
        views.setPendingIntentTemplate(R.id.home_control_list, rowClickPendingIntent);

        int immutableFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent resetIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("misterlapkins://open?action=reset-devices"));
        resetIntent.setPackage(context.getPackageName());
        PendingIntent resetPendingIntent = PendingIntent.getActivity(context, appWidgetId * 100 + 2, resetIntent, immutableFlags);
        views.setOnClickPendingIntent(R.id.home_control_reset_btn, resetPendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
