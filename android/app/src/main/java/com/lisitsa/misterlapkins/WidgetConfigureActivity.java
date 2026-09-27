package com.lisitsa.misterlapkins;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

// Picks which shopping list a widget instance shows (see MrLapkinsWidgetProvider.selectedListId).
// Reached two ways, both fine to share one Activity:
//   1. The system's own widget-placement flow (android:configure in mr_lapkins_widget_info.xml,
//      action ACTION_APPWIDGET_CONFIGURE) — first time the widget is dragged onto the home screen.
//      Must call setResult(RESULT_OK, ...) before finishing, or the system removes the
//      just-placed widget entirely (that's how the configure contract works).
//   2. A plain PendingIntent from the widget's own list-name button (MrLapkinsWidgetProvider) to
//      re-pick later — no configure contract involved, just a normal screen, finish() is enough.
// A list here is read from lists_json (already pushed by WidgetBridgePlugin/src/widgetBridge.js)
// rather than fetched live — this activity has no access to the WebView's own `state`.
public class WidgetConfigureActivity extends Activity {

    private int appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.widget_configure);

        // Standard "cancel unless explicitly confirmed" default for the configure-contract case —
        // harmless no-op for the plain-reopen case (see class comment), since only the system's
        // own configure flow ever inspects this result.
        Intent resultValue = new Intent();
        setResult(RESULT_CANCELED, resultValue);

        Bundle extras = getIntent().getExtras();
        if (extras != null) {
            appWidgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        }
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        populateListButtons();
    }

    private void populateListButtons() {
        LinearLayout container = findViewById(R.id.configure_list_container);
        TextView emptyText = findViewById(R.id.configure_empty_text);
        SharedPreferences prefs = getSharedPreferences(MrLapkinsWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        String currentSelection = MrLapkinsWidgetProvider.selectedListId(this, appWidgetId);

        JSONArray lists;
        try {
            lists = new JSONArray(prefs.getString(MrLapkinsWidgetProvider.PREF_LISTS_JSON, "[]"));
        } catch (Exception e) {
            lists = new JSONArray();
        }

        if (lists.length() == 0) {
            emptyText.setVisibility(android.view.View.VISIBLE);
            return;
        }

        for (int i = 0; i < lists.length(); i++) {
            JSONObject list = lists.optJSONObject(i);
            if (list == null) continue;
            final String listId = list.optString("id", "");
            String name = list.optString("name", "");
            if (listId.length() == 0) continue;

            Button btn = new Button(this);
            btn.setText(name.length() > 0 ? name : listId);
            btn.setAllCaps(false);
            btn.setTextColor(getColor(R.color.widget_text));
            btn.setBackgroundColor(listId.equals(currentSelection)
                ? getColor(R.color.widget_accent)
                : android.graphics.Color.TRANSPARENT);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.bottomMargin = dp(8);
            btn.setLayoutParams(params);
            btn.setOnClickListener(v -> selectList(listId));
            container.addView(btn);
        }
    }

    private void selectList(String listId) {
        getSharedPreferences(MrLapkinsWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(MrLapkinsWidgetProvider.PREF_SELECTED_LIST_PREFIX + appWidgetId, listId)
            .apply();

        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(this);
        // Only this one widget instance needs its list-name/row content refreshed — reuses
        // MrLapkinsWidgetProvider's own onUpdate path (same effect as the system calling it) plus
        // the same "list content changed" signal pushUpdate() sends after every real data save.
        new MrLapkinsWidgetProvider().onUpdate(this, appWidgetManager, new int[]{appWidgetId});
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_shopping_list);

        Intent resultValue = new Intent();
        resultValue.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        setResult(RESULT_OK, resultValue);
        finish();
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }
}
