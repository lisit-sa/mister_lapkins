package com.lisitsa.misterlapkins;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

// Backs both ListViews in widget_main.xml (Дела and Покупки) — one service, parameterized by the
// "listType" extra on the Intent MrLapkinsWidgetProvider builds in listAdapterIntent(), rather
// than two near-identical service classes. See the widget plan doc.
public class WidgetListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        String listType = intent.getStringExtra("listType");
        int appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        return new WidgetRemoteViewsFactory(getApplicationContext(), "shopping".equals(listType) ? "shopping" : "tasks", appWidgetId);
    }

    private static class WidgetRemoteViewsFactory implements RemoteViewsFactory {
        private final Context context;
        private final String listType;
        private final int appWidgetId;
        private final List<Row> rows = new ArrayList<>();
        // Set by loadRows() when listType is "shopping" — carried on each row's checkbox
        // fillInIntent (see getViewAt) so a widget pinned to a non-active list still replays its
        // toggle against the right one (toggleShoppingItem needs to know which list an id is in).
        private String selectedListId = "";

        WidgetRemoteViewsFactory(Context context, String listType, int appWidgetId) {
            this.context = context;
            this.listType = listType;
            this.appWidgetId = appWidgetId;
        }

        @Override
        public void onCreate() {
            loadRows();
        }

        // Called by the framework after AppWidgetManager.notifyAppWidgetViewDataChanged() (see
        // MrLapkinsWidgetProvider.pushUpdate) — this, not onCreate, is what actually picks up a
        // fresh save from the app. Runs off the main thread per the RemoteViewsFactory contract,
        // so the synchronous SharedPreferences read + JSON parse here is safe.
        @Override
        public void onDataSetChanged() {
            loadRows();
        }

        private void loadRows() {
            rows.clear();
            SharedPreferences prefs = context.getSharedPreferences(MrLapkinsWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
            // Checked off from the widget itself but not yet replayed by the app (see
            // MrLapkinsWidgetProvider's top comment) — skip these rather than waiting for the next
            // real snapshot, so a tap disappears the item right away.
            java.util.Set<String> hidden = MrLapkinsWidgetProvider.hiddenIds(context);
            try {
                if ("shopping".equals(listType)) {
                    // This instance's configured list (see MrLapkinsWidgetProvider.selectedListId)
                    // — lists_json carries every list's items now, not just whichever one is
                    // active in-app, precisely so a widget can be pinned to a specific one.
                    selectedListId = MrLapkinsWidgetProvider.selectedListId(context, appWidgetId);
                    JSONArray lists = new JSONArray(prefs.getString(MrLapkinsWidgetProvider.PREF_LISTS_JSON, "[]"));
                    for (int i = 0; i < lists.length(); i++) {
                        JSONObject l = lists.getJSONObject(i);
                        if (!selectedListId.equals(l.optString("id", ""))) continue;
                        JSONArray items = l.optJSONArray("items");
                        if (items == null) break;
                        for (int j = 0; j < items.length(); j++) {
                            JSONObject obj = items.getJSONObject(j);
                            String name = obj.optString("name", "");
                            String id = obj.optString("id", "");
                            if (name.length() > 0 && !hidden.contains(id)) rows.add(new Row(id, name));
                        }
                        break;
                    }
                } else {
                    JSONArray arr = new JSONArray(prefs.getString(MrLapkinsWidgetProvider.PREF_TASKS_JSON, "[]"));
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject obj = arr.getJSONObject(i);
                        String title = obj.optString("title", "");
                        String id = obj.optString("id", "");
                        if (title.length() > 0 && !hidden.contains(id)) rows.add(new Row(id, title));
                    }
                }
            } catch (Exception e) {
                // Malformed/stale JSON (e.g. a build mismatch mid-update) — an empty list is a
                // safe fallback, matches how the app's own widgetBridge.js only ever writes
                // well-formed arrays, so this should be rare.
            }
        }

        @Override
        public void onDestroy() {
            rows.clear();
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            Row row = rows.get(position);
            boolean shopping = "shopping".equals(listType);
            int layoutId = shopping ? R.layout.widget_shopping_row : R.layout.widget_task_row;
            RemoteViews views = new RemoteViews(context.getPackageName(), layoutId);
            views.setTextViewText(R.id.widget_row_title, row.title);

            // Whole row (circle + title) checks the item off right here — see
            // MrLapkinsWidgetProvider.handleRowClick — no app launch (2026-09-17, revised: was just
            // the circle, but Kristina expected tapping the text to cross it out too).
            Intent checkIntent = new Intent();
            checkIntent.putExtra("itemId", row.id);
            checkIntent.putExtra("listType", listType);
            checkIntent.putExtra("clickTarget", "checkbox");
            if (shopping) checkIntent.putExtra("listId", selectedListId);
            views.setOnClickFillInIntent(R.id.widget_row_root, checkIntent);

            // Pencil — its own smaller nested target (wins over the root's fillInIntent wherever it
            // overlaps) that opens this specific item for editing instead of just checking it off.
            Intent editIntent = new Intent();
            editIntent.putExtra("itemId", row.id);
            editIntent.putExtra("listType", listType);
            editIntent.putExtra("clickTarget", "edit");
            if (shopping) editIntent.putExtra("listId", selectedListId);
            views.setOnClickFillInIntent(R.id.widget_row_edit, editIntent);

            return views;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null; // default platform loading view is fine
        }

        @Override
        public int getViewTypeCount() {
            return 2; // widget_task_row / widget_shopping_row — this factory only ever uses one of the two per instance, but the count must cover both possible layouts this class can return
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }

        private static class Row {
            final String id;
            final String title;
            Row(String id, String title) { this.id = id; this.title = title; }
        }
    }
}
