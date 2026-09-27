// Bridges the home-screen widget (MrLapkinsWidgetProvider/WidgetBridgePlugin.java, android/app/
// src/main/java/com/lisitsa/misterlapkins/) — bundled with esbuild (see package.json's
// "build:widgetbridge" script) into www/widgetBridge.bundle.js, same convention as the other
// native-plugin modules (src/battery.js etc.). Talks to the rest of the (unbundled) app only
// through window.AppWidgetBridge.
//
// Deliberately thin — index.html decides WHAT goes in the snapshot (which tasks/items, how many),
// this module just hands it to the native side. See the widget plan doc for the full picture.
import { registerPlugin } from "@capacitor/core";

var WidgetBridge = registerPlugin("WidgetBridge");

window.AppWidgetBridge = {
  // tasks: [{id, title}]; lists: [{id, name, items: [{id, name}]}] — every shopping list, not
  // just the active one, so the widget's own per-instance list picker (see
  // WidgetConfigureActivity.java) has something to choose from; activeListId flags which one is
  // "the" active list in-app right now, used as the fallback for a widget that hasn't been
  // configured yet. All already filtered/trimmed by the caller (see updateWidgetSnapshot() in
  // index.html). Resolves false (not reject) on iOS/web where the native plugin doesn't exist,
  // same no-native-answer-is-fine convention as AppBattery.
  updateSnapshot: function(tasks, lists, activeListId){
    return WidgetBridge.updateSnapshot({ tasks: tasks || [], lists: lists || [], activeListId: activeListId || "" }).catch(function(e){
      console.warn("AppWidgetBridge: updateSnapshot failed", e);
      return false;
    });
  },
  // Phase 2 (tap-to-check-off) — reads and clears, in one native call, whatever checkbox taps
  // happened in the widget since the last time this was called. Resolves [] (not reject) on
  // iOS/web or on any native error, same convention as updateSnapshot above — index.html just
  // replays whatever comes back, so an empty array here is indistinguishable from "nothing to do".
  takePendingActions: function(){
    return WidgetBridge.takePendingActions().then(function(r){
      return (r && r.actions) || [];
    }).catch(function(e){
      console.warn("AppWidgetBridge: takePendingActions failed", e);
      return [];
    });
  },
  // "Добавить виджет" in the sidebar (2026-09-17) — whether AppWidgetManager.requestPinAppWidget()
  // is even available on this launcher, checked fresh each time the sidebar opens (see
  // refreshAddWidgetButtonVisibility in index.html) so the button is hidden entirely rather than
  // sitting there doing nothing on a launcher that doesn't support it. Resolves false on
  // iOS/web/any error, same convention as the rest of this module.
  isPinWidgetSupported: function(){
    return WidgetBridge.isPinWidgetSupported().then(function(r){
      return !!(r && r.supported);
    }).catch(function(e){
      console.warn("AppWidgetBridge: isPinWidgetSupported failed", e);
      return false;
    });
  },
  // Fires the OS's own "add this widget to your home screen?" confirmation directly, instead of
  // making someone find Mr. Lapkins by hand in the system's general widget picker.
  requestPinWidget: function(){
    return WidgetBridge.requestPinWidget().catch(function(e){
      console.warn("AppWidgetBridge: requestPinWidget failed", e);
      return false;
    });
  }
};
