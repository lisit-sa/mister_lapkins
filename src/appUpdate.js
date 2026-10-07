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

// Throttles only the Google dialog itself (per offered versionCode), not the check — throttling
// the check (as the first version did, 2026-09-20) meant a launch that found nothing still blocked
// the next 24h, so a fresh release could go unnoticed for over a day (reported 2026-10-05).
var LAST_PROMPT_KEY = "appUpdateLastPrompt";
var PROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function promptedRecently(versionCode){
  try{
    var last = JSON.parse(localStorage.getItem(LAST_PROMPT_KEY) || "null");
    return !!last && last.versionCode === versionCode && Date.now() - last.at < PROMPT_INTERVAL_MS;
  }catch(e){
    return false;
  }
}

function rememberPrompt(versionCode){
  try{ localStorage.setItem(LAST_PROMPT_KEY, JSON.stringify({ versionCode: versionCode, at: Date.now() })); }catch(e){}
}

window.AppUpdate = {
  // onDownloaded: called once the background download finished and a restart is all that's left.
  init: function(onDownloaded){
    var restart = function(){ AppUpdate.completeFlexibleUpdate().catch(function(){}); };

    AppUpdate.getAppUpdateInfo().then(function(info){
      if(!info) return;
      // Downloaded on an earlier launch but the app was closed before the restart offer — the
      // listener below died with that process, so offer the restart again now.
      if(info.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED){
        if(onDownloaded) onDownloaded(restart);
        return;
      }
      if(info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) return;
      if(!info.flexibleUpdateAllowed) return;
      if(promptedRecently(info.availableVersionCode)) return;
      rememberPrompt(info.availableVersionCode);
      AppUpdate.addListener("onFlexibleUpdateStateChange", function(state){
        if(state && state.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED && onDownloaded){
          onDownloaded(restart);
        }
      });
      return AppUpdate.startFlexibleUpdate();
    }).catch(function(e){
      console.warn("AppUpdate: check skipped", e && e.message);
    });
  }
};
