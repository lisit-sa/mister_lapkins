// Firebase Analytics via the native @capacitor-firebase/analytics plugin — bundled with esbuild
// (see package.json's "build:analytics" script) into www/analytics.bundle.js, the same
// convention haptics.js/cloud-sync.js use. Talks to the rest of the (non-module, unbundled) app
// only through window.AppAnalytics.
//
// Native only: on the hosted PWA build (Capacitor.isNativePlatform() false) every call is a
// no-op, so the web version stays analytics-free. Native plugin, so — like widgetBridge/
// appUpdate — this only starts reporting after a native rebuild, not an OTA web update alone;
// on an older APK without the plugin the calls just fail quietly below.
//
// Never send task/note text, titles, categories or anything else the user typed — only event
// names and coarse enums (see privacy policy, hosting/privacy/index.html).
import { Capacitor } from "@capacitor/core";
import { FirebaseAnalytics } from "@capacitor-firebase/analytics";

var enabled = Capacitor.isNativePlatform();

// Swallows any plugin/platform error so analytics can never break the action that triggered it.
function call(fn){
  if(!enabled) return;
  try{
    fn().catch(function(e){ console.error("AppAnalytics: failed", e); });
  }catch(e){
    console.error("AppAnalytics: failed", e);
  }
}

window.AppAnalytics = {
  logEvent: function(name, params){
    call(function(){ return FirebaseAnalytics.logEvent({ name: name, params: params || {} }); });
  },
  screen: function(screenName){
    call(function(){ return FirebaseAnalytics.setCurrentScreen({ screenName: screenName }); });
  }
};
