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
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

// Single home-screen widget covering both Дела and Покупки — one AppWidgetProvider with a
// ViewFlipper (see res/layout/widget_main.xml) rather than two separate widgets, per the widget
// plan doc (design discussion 2026-09-16: saves home-screen space, and RemoteViews actually
// supports ViewFlipper as a widget container, so this isn't a hack).
//
// Data flow: WidgetBridgePlugin.updateSnapshot() (called from src/widgetBridge.js, itself called
// from saveState() in index.html) writes the latest tasks + EVERY shopping list's items into
// SharedPreferences as plain JSON strings, then calls pushUpdate() here so every existing widget
// instance refreshes immediately — not just whenever Android's own updatePeriodMillis timer fires
// (see mr_lapkins_widget_info.xml). WidgetListService/its RemoteViewsFactory is what actually
// reads the JSON for whichever list this widget instance is configured to show (see
// PREF_SELECTED_LIST_PREFIX/WidgetConfigureActivity) and turns it into rows.
//
// Phase 2 (tap-to-check-off, 2026-09-17): a row's checkbox no longer just opens the app — it
// hides the row immediately (optimistic) and queues a {type, id, listId} entry in
// PREF_PENDING_ACTIONS_JSON, which src/widgetBridge.js/index.html drains on the next app
// launch/resume and replays through the real toggleTask()/toggleShoppingItem() so recurrence,
// rewards and Firestore sync all happen exactly like an in-app tap — see the widget plan doc.
// Tapping the rest of the row (not the checkbox) still just opens the app, same as Phase 1.
public class MrLapkinsWidgetProvider extends AppWidgetProvider {

    static final String PREFS_NAME = "mr_lapkins_widget_prefs";
    static final String PREF_TASKS_JSON = "tasks_json";
    static final String PREF_LISTS_JSON = "lists_json";
    static final String PREF_ACTIVE_LIST_ID = "active_list_id";
    static final String PREF_PENDING_ACTIONS_JSON = "pending_actions_json";
    // Ids hidden from the widget's own rows right after a checkbox tap, before the app has had a
    // chance to actually replay the action and push a fresh snapshot without that item — without
    // this the row would sit there un-struck until the app is next opened, which reads as "nothing
    // happened" even though the tap itself was recorded fine.
    private static final String PREF_HIDDEN_IDS_JSON = "hidden_ids_json";
    private static final int MAX_PENDING_ACTIONS = 50;
    private static final String PREF_TAB_PREFIX = "tab_";
    // Which shopping list THIS widget instance shows — set by WidgetConfigureActivity, falls back
    // to whichever list is active in-app (PREF_ACTIVE_LIST_ID) if never configured.
    static final String PREF_SELECTED_LIST_PREFIX = "selected_list_";

    private static final String ACTION_SHOW_TASKS = "com.lisitsa.misterlapkins.widget.SHOW_TASKS";
    private static final String ACTION_SHOW_SHOPPING = "com.lisitsa.misterlapkins.widget.SHOW_SHOPPING";
    private static final String ACTION_ROW_CLICK = "com.lisitsa.misterlapkins.widget.ROW_CLICK";
    // requestPinAppWidget()'s successCallback (see WidgetBridgePlugin.requestPinWidget) — the only
    // actual confirmation a user gets that tapping "Добавить виджет" in the sidebar did anything,
    // since MIUI's launcher doesn't show any dismissable confirmation UI of its own for a pin
    // request, it just places the widget straight away (reported by Kristina, 2026-09-17).
    private static final String ACTION_PIN_SUCCESS = "com.lisitsa.misterlapkins.widget.PIN_SUCCESS";
    private static final int TAB_TASKS = 0;
    private static final int TAB_SHOPPING = 1;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidgetInstance(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();

        if (ACTION_ROW_CLICK.equals(action)) {
            handleRowClick(context, intent);
            return;
        }

        if (ACTION_PIN_SUCCESS.equals(action)) {
            android.widget.Toast.makeText(context, R.string.widget_pinned_toast, android.widget.Toast.LENGTH_LONG).show();
            return;
        }

        if (!ACTION_SHOW_TASKS.equals(action) && !ACTION_SHOW_SHOPPING.equals(action)) return;

        int appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return;

        int tab = ACTION_SHOW_TASKS.equals(action) ? TAB_TASKS : TAB_SHOPPING;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putInt(PREF_TAB_PREFIX + appWidgetId, tab).apply();

        updateAppWidgetInstance(context, AppWidgetManager.getInstance(context), appWidgetId);
    }

    // "checkbox" tap (the whole row, see WidgetListService.getViewAt): hide the row immediately +
    // queue the real toggle for the app to replay next time it's open (see this class's own top
    // comment). "edit" tap (the pencil, a smaller nested target that wins over the row's own
    // fillInIntent wherever it overlaps): opens the app straight into editing that specific item —
    // reuses the misterlapkins://open deep link (same mechanism as the add-task/add-shopping
    // buttons) with the extra id/listId params index.html's handleWidgetAction reads (2026-09-17,
    // revised from an earlier "tap anything but the checkbox opens the app generically" behavior,
    // which read as pointless once the whole row already checks the item off).
    private void handleRowClick(Context context, Intent intent) {
        String itemId = intent.getStringExtra("itemId");
        if (itemId == null || itemId.length() == 0) return;
        String clickTarget = intent.getStringExtra("clickTarget");
        String listType = intent.getStringExtra("listType");
        String listId = intent.getStringExtra("listId");

        if ("edit".equals(clickTarget)) {
            StringBuilder uri = new StringBuilder("misterlapkins://open?action=");
            uri.append("shopping".equals(listType) ? "edit-shopping" : "edit-task");
            uri.append("&id=").append(Uri.encode(itemId));
            if (listId != null) uri.append("&listId=").append(Uri.encode(listId));
            Intent openIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri.toString()));
            openIntent.setPackage(context.getPackageName());
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(openIntent);
            return;
        }

        addHiddenId(context, itemId);
        addPendingAction(context, listType, itemId, listId);

        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(new ComponentName(context, MrLapkinsWidgetProvider.class));
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds,
            "shopping".equals(listType) ? R.id.widget_shopping_list : R.id.widget_tasks_list);
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        // Tidy up the per-instance tab/list choice for whichever widgets just got removed from the
        // home screen — harmless to leave stale, but there's no reason to let this grow forever.
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        for (int appWidgetId : appWidgetIds) {
            editor.remove(PREF_TAB_PREFIX + appWidgetId);
            editor.remove(PREF_SELECTED_LIST_PREFIX + appWidgetId);
        }
        editor.apply();
    }

    // Called from WidgetBridgePlugin.updateSnapshot() whenever the app itself saves new data —
    // this is the "instant" refresh path; updatePeriodMillis in mr_lapkins_widget_info.xml is only
    // a fallback floor for whenever the app hasn't been opened in a while.
    static void pushUpdate(Context context) {
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        ComponentName componentName = new ComponentName(context, MrLapkinsWidgetProvider.class);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(componentName);
        for (int appWidgetId : appWidgetIds) {
            updateAppWidgetInstance(context, appWidgetManager, appWidgetId);
        }
        // Tells each ListView's RemoteViewsFactory to re-run onDataSetChanged() (re-read the fresh
        // JSON) — setRemoteAdapter alone (inside updateAppWidgetInstance) doesn't force a requery
        // once an adapter is already bound, this is the actual "your data changed" signal for
        // collection widgets.
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_tasks_list);
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_shopping_list);
    }

    // Which shopping list id this widget instance should show — configured value if there is one
    // (and it still exists in the latest lists_json), else whatever's active in-app right now.
    // Shared with WidgetListService (reads the same preference to pick which list's items to
    // render) so the header name and the actual row content never disagree about which list this is.
    static String selectedListId(Context context, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String selected = prefs.getString(PREF_SELECTED_LIST_PREFIX + appWidgetId, null);
        if (selected != null) return selected;
        return prefs.getString(PREF_ACTIVE_LIST_ID, "");
    }

    // Ids hidden from the widget's rows right now (checked off but not yet replayed by the app) —
    // shared with WidgetListService.loadRows(), which filters them out.
    static Set<String> hiddenIds(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> result = new HashSet<>();
        try {
            JSONArray arr = new JSONArray(prefs.getString(PREF_HIDDEN_IDS_JSON, "[]"));
            for (int i = 0; i < arr.length(); i++) result.add(arr.getString(i));
        } catch (Exception e) {
            // malformed — treat as "nothing hidden"
        }
        return result;
    }

    private static void addHiddenId(Context context, String id) {
        Set<String> ids = hiddenIds(context);
        ids.add(id);
        JSONArray arr = new JSONArray();
        for (String existing : ids) arr.put(existing);
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(PREF_HIDDEN_IDS_JSON, arr.toString()).apply();
    }

    // Called from WidgetBridgePlugin.updateSnapshot() — a fresh snapshot from the app is
    // authoritative (it already reflects every replayed action), so anything still being hidden
    // purely optimistically is no longer needed and would otherwise accumulate forever.
    static void clearHiddenIds(Context context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .remove(PREF_HIDDEN_IDS_JSON).apply();
    }

    private static void addPendingAction(Context context, String listType, String itemId, String listId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSONArray actions;
        try {
            actions = new JSONArray(prefs.getString(PREF_PENDING_ACTIONS_JSON, "[]"));
        } catch (Exception e) {
            actions = new JSONArray();
        }
        JSONObject entry = new JSONObject();
        try {
            entry.put("type", "shopping".equals(listType) ? "shopping" : "task");
            entry.put("id", itemId);
            if (listId != null) entry.put("listId", listId);
        } catch (Exception e) {
            return; // shouldn't happen — JSONObject.put only throws on a null key
        }
        actions.put(entry);
        // Defensive cap — the app should normally drain this within seconds of the widget being
        // used, so hitting this would mean it hasn't been opened in a very long time.
        while (actions.length() > MAX_PENDING_ACTIONS) actions.remove(0);
        prefs.edit().putString(PREF_PENDING_ACTIONS_JSON, actions.toString()).apply();
    }

    // Reads lists_json and finds the display name for a given list id — "" if it's not there
    // (deleted, or nothing synced yet).
    private static String listNameFor(Context context, String listId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            JSONArray lists = new JSONArray(prefs.getString(PREF_LISTS_JSON, "[]"));
            for (int i = 0; i < lists.length(); i++) {
                JSONObject l = lists.getJSONObject(i);
                if (listId.equals(l.optString("id", ""))) return l.optString("name", "");
            }
        } catch (Exception e) {
            // malformed JSON — treated the same as "not found" below
        }
        return "";
    }

    private static void updateAppWidgetInstance(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_main);

        views.setOnClickPendingIntent(R.id.widget_tab_tasks_btn, tabPendingIntent(context, appWidgetId, ACTION_SHOW_TASKS, appWidgetId * 2));
        views.setOnClickPendingIntent(R.id.widget_tab_shopping_btn, tabPendingIntent(context, appWidgetId, ACTION_SHOW_SHOPPING, appWidgetId * 2 + 1));

        views.setRemoteAdapter(R.id.widget_tasks_list, listAdapterIntent(context, appWidgetId, "tasks"));
        views.setRemoteAdapter(R.id.widget_shopping_list, listAdapterIntent(context, appWidgetId, "shopping"));
        views.setEmptyView(R.id.widget_tasks_list, R.id.widget_tasks_empty);
        views.setEmptyView(R.id.widget_shopping_list, R.id.widget_shopping_empty);

        int openAppFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        // Row clicks (Phase 2) — every row's fillInIntent (see WidgetRemoteViewsFactory.getViewAt)
        // carries which sub-view was tapped (checkbox vs body) plus the item's id/listType/listId,
        // merged into this same broadcast template on click; handleRowClick() is what actually
        // decides what that means. A broadcast template (not straight to MainActivity, like Phase 1
        // had) is required here since a checkbox tap must NOT open the app at all.
        // FLAG_MUTABLE, NOT FLAG_IMMUTABLE — the whole fillInIntent mechanism is the system merging
        // each row's extras into this template's Intent at click time, and Android 12+ silently
        // refuses that merge on an immutable PendingIntent, so every tap arrived at handleRowClick()
        // with itemId == null and got dropped by its early-return guard (reported by Kristina,
        // 2026-09-17: "ничего не происходит" on both the checkbox and the row text).
        int rowClickFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        Intent rowClickIntent = new Intent(context, MrLapkinsWidgetProvider.class);
        rowClickIntent.setAction(ACTION_ROW_CLICK);
        PendingIntent rowClickPendingIntent = PendingIntent.getBroadcast(context, appWidgetId * 100 + 6, rowClickIntent, rowClickFlags);
        views.setPendingIntentTemplate(R.id.widget_tasks_list, rowClickPendingIntent);
        views.setPendingIntentTemplate(R.id.widget_shopping_list, rowClickPendingIntent);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int activeTab = prefs.getInt(PREF_TAB_PREFIX + appWidgetId, TAB_TASKS);
        views.setDisplayedChild(R.id.widget_flipper, activeTab);

        // Дела = green, Покупки = beige (2026-09-17, "like browser tabs" per Kristina, redesigned
        // once more per her own sketch of the look) — the root (header/content/footer all sit on
        // it) swaps to match the active tab. The active tab's OWN button background is cleared
        // (resource 0) so it's just text sitting directly on this matching-color root — that's what
        // makes it read as merged into the page below. The inactive one gets its fixed-color block
        // instead (widget_tab_inactive_tasks.xml/_shopping.xml). setInt(..., "setBackgroundResource"/
        // "setBackgroundColor", ...) is RemoteViews' reflection-based way to call setters Android
        // didn't give dedicated RemoteViews methods for.
        boolean tasksActive = activeTab == TAB_TASKS;
        views.setInt(R.id.widget_root, "setBackgroundResource",
            tasksActive ? R.drawable.widget_rounded_bg : R.drawable.widget_rounded_bg_shopping);
        views.setInt(R.id.widget_tab_tasks_btn, "setBackgroundResource",
            tasksActive ? 0 : R.drawable.widget_tab_inactive_tasks);
        views.setInt(R.id.widget_tab_shopping_btn, "setBackgroundResource",
            tasksActive ? R.drawable.widget_tab_inactive_shopping : 0);

        // Explicit add-task / add-shopping button — only the one matching the active tab is shown
        // (2026-09-17: was both side by side, which read as confusing/redundant since only one is
        // ever relevant to what's on screen). Reuses the existing misterlapkins:// deep-link
        // mechanism (src/deeplink.js, AndroidManifest.xml's host="open" data element, both added
        // 2026-09-16) rather than a new one — setPackage() pins it to this app specifically since a
        // bare ACTION_VIEW on a custom scheme could otherwise prompt a chooser if some other app
        // ever claims the same scheme.
        views.setOnClickPendingIntent(R.id.widget_add_task_btn, deepLinkPendingIntent(context, appWidgetId * 100 + 3, "add-task", openAppFlags));
        views.setOnClickPendingIntent(R.id.widget_add_shopping_btn, deepLinkPendingIntent(context, appWidgetId * 100 + 4, "add-shopping", openAppFlags));
        views.setViewVisibility(R.id.widget_add_task_btn, activeTab == TAB_TASKS ? android.view.View.VISIBLE : android.view.View.GONE);
        views.setViewVisibility(R.id.widget_add_shopping_btn, activeTab == TAB_SHOPPING ? android.view.View.VISIBLE : android.view.View.GONE);

        // List name / picker — shows which list this instance is configured for (see
        // selectedListId) and re-opens the same configure screen shown when the widget was first
        // added, so picking a different list later doesn't require removing and re-adding it.
        // Only shown on the Покупки tab — a shopping-list name under Дела read as a display bug
        // to Kristina in testing (2026-09-17), since it has nothing to do with the tasks showing.
        views.setViewVisibility(R.id.widget_list_name_row, activeTab == TAB_SHOPPING ? android.view.View.VISIBLE : android.view.View.GONE);
        String selectedListId = selectedListId(context, appWidgetId);
        String listName = listNameFor(context, selectedListId);
        views.setTextViewText(R.id.widget_list_name, listName.length() > 0 ? listName : context.getString(R.string.widget_tab_shopping));
        Intent configureIntent = new Intent(context, WidgetConfigureActivity.class);
        configureIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        PendingIntent configurePendingIntent = PendingIntent.getActivity(context, appWidgetId * 100 + 5, configureIntent, openAppFlags);
        views.setOnClickPendingIntent(R.id.widget_list_name_row, configurePendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static PendingIntent deepLinkPendingIntent(Context context, int requestCode, String action, int flags) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("misterlapkins://open?action=" + action));
        intent.setPackage(context.getPackageName());
        return PendingIntent.getActivity(context, requestCode, intent, flags);
    }


    private static PendingIntent tabPendingIntent(Context context, int appWidgetId, String action, int requestCode) {
        Intent intent = new Intent(context, MrLapkinsWidgetProvider.class);
        intent.setAction(action);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }

    // Passed as requestPinAppWidget()'s successCallback (see WidgetBridgePlugin.requestPinWidget) —
    // fired by the OS once the widget is actually placed, which is what triggers the toast above.
    static PendingIntent pinSuccessPendingIntent(Context context) {
        Intent intent = new Intent(context, MrLapkinsWidgetProvider.class);
        intent.setAction(ACTION_PIN_SUCCESS);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(context, 999, intent, flags);
    }

    // setData() with a unique URI (not otherwise meaningful — just distinguishes the two lists'
    // adapter Intents from each other) is standard boilerplate here: two setRemoteAdapter Intents
    // that only differ by an extra can otherwise get confused/cached against each other by the
    // framework, since Intent equality for this purpose is filter-based, not extras-based.
    private static Intent listAdapterIntent(Context context, int appWidgetId, String listType) {
        Intent intent = new Intent(context, WidgetListService.class);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        intent.putExtra("listType", listType);
        intent.setData(Uri.parse("widget://" + context.getPackageName() + "/" + listType + "/" + appWidgetId));
        return intent;
    }
}
