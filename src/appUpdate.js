// Google Play In-App Updates (2026-09-20) — nudges people on an old native build to update, since
// a new native build (e.g. one adding the home-screen widget) can't arrive through the OTA
// web-bundle channel (src/updater.js) and Play itself sends no "please update" notification.
// Bundled with esbuild (see package.json's "build:appupdate" script) into www/appUpdate.bundle.js,
// same convention as the other native-plugin modules; talks to the rest of the app only through
// window.AppUpdate.
//
// Flexible flow: Google's own dialog asks once, the download happens in the background while the
// app stays usable, then onDownloaded fires so index.html can offer a restart. Every failure path
// (sideloaded/debug build, not installed from Play, no network, iOS/web) resolves quietly — this is
// a nicety, never something that should surface an error or block launch.
import { AppUpdate, AppUpdateAvailability, FlexibleUpdateInstallStatus } from "@capawesome/capacitor-app-update";

var LAST_CHECK_KEY = "appUpdateLastCheck";
var CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

window.AppUpdate = {
  // onDownloaded: called once the background download finished and a restart is all that's left.
  init: function(onDownloaded){
    try{
      var last = parseInt(localStorage.getItem(LAST_CHECK_KEY) || "0", 10);
      if(Date.now() - last < CHECK_INTERVAL_MS) return;
    }catch(e){}

    AppUpdate.getAppUpdateInfo().then(function(info){
      try{ localStorage.setItem(LAST_CHECK_KEY, String(Date.now())); }catch(e){}
      if(!info || info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) return;
      if(!info.flexibleUpdateAllowed) return;
      AppUpdate.addListener("onFlexibleUpdateStateChange", function(state){
        if(state && state.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED && onDownloaded){
          onDownloaded(function(){ AppUpdate.completeFlexibleUpdate().catch(function(){}); });
        }
      });
      return AppUpdate.startFlexibleUpdate();
    }).catch(function(e){
      console.warn("AppUpdate: check skipped", e && e.message);
    });
  }
};
