package com.lisitsa.misterlapkins;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

// Backs the ListView in widget_home_control.xml — see HomeControlWidgetProvider's own comment for
// the full "Контроль дома" widget picture.
public class HomeControlListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new HomeControlRemoteViewsFactory(getApplicationContext());
    }

    private static class HomeControlRemoteViewsFactory implements RemoteViewsFactory {
        private final Context context;
        private final List<Row> rows = new ArrayList<>();

        HomeControlRemoteViewsFactory(Context context) {
            this.context = context;
        }

        @Override
        public void onCreate() {
            loadRows();
        }

        // See WidgetListService's own comment on this same method — same reasoning here:
        // AppWidgetManager.notifyAppWidgetViewDataChanged() (HomeControlWidgetProvider.pushUpdate)
        // is what actually triggers this, not onCreate.
        @Override
        public void onDataSetChanged() {
            loadRows();
        }

        private void loadRows() {
            rows.clear();
            SharedPreferences prefs = context.getSharedPreferences(HomeControlWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
            try {
                JSONArray arr = new JSONArray(prefs.getString(HomeControlWidgetProvider.PREF_DEVICES_JSON, "[]"));
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject obj = arr.getJSONObject(i);
                    String name = obj.optString("name", "");
                    String id = obj.optString("id", "");
                    if (name.length() > 0 && id.length() > 0) {
                        rows.add(new Row(id, name, obj.optBoolean("checked", false), obj.optString("photo", "")));
                    }
                }
            } catch (Exception e) {
                // Malformed/stale JSON — an empty list is a safe fallback, same reasoning as
                // WidgetListService's own catch.
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
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_device_row);
            views.setTextViewText(R.id.widget_row_title, row.name);
            views.setTextViewText(R.id.widget_row_status, context.getString(
                row.checked ? R.string.home_control_status_checked : R.string.home_control_status_unchecked));

            // "Light" photo thumbnail (2026-09-27, see widget_device_row.xml's own comment) — only
            // ever the latest one, already compressed by compressImageToBase64() in index.html
            // before it's ever sent here, so no extra resizing needed on this side. Decoding runs
            // on this factory's own binder thread (never the main thread — same guarantee
            // onDataSetChanged/loadRows already rely on), so a slow decode can't jank the UI.
            Bitmap thumb = decodePhoto(row.photoDataUrl);
            if (thumb != null) {
                views.setViewVisibility(R.id.widget_row_thumb, View.VISIBLE);
                views.setImageViewBitmap(R.id.widget_row_thumb, thumb);
            } else {
                views.setViewVisibility(R.id.widget_row_thumb, View.GONE);
            }

            Intent fillIn = new Intent();
            fillIn.putExtra("deviceId", row.id);
            views.setOnClickFillInIntent(R.id.widget_row_root, fillIn);

            return views;
        }

        // photo is stored as a full data: URL (canvas.toDataURL's own format, see
        // compressImageToBase64 in index.html) — strip the "data:image/jpeg;base64," prefix before
        // handing the rest to Base64.decode. Returns null for anything malformed/empty rather than
        // throwing, since a missing/corrupt photo just means "show no thumbnail", not a real error.
        private static Bitmap decodePhoto(String dataUrl) {
            if (dataUrl == null || dataUrl.length() == 0) return null;
            int comma = dataUrl.indexOf(',');
            if (comma < 0) return null;
            try {
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            } catch (Exception e) {
                return null;
            }
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
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
            final String name;
            final boolean checked;
            final String photoDataUrl;
            Row(String id, String name, boolean checked, String photoDataUrl) {
                this.id = id;
                this.name = name;
                this.checked = checked;
                this.photoDataUrl = photoDataUrl;
            }
        }
    }
}
