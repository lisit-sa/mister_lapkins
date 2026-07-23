// Over-the-air updates for the web bundle (HTML/CSS/JS/images/sounds under www/) via
// @capgo/capacitor-updater, self-hosted on Firebase Hosting instead of Capgo's paid cloud —
// bundled with esbuild (see package.json's "build:updater" script) into www/updater.bundle.js,
// the same convention cloud-sync.js and audioManager.js use. Talks to the rest of the
// (unbundled) app only through window.AppUpdater.
//
// How a release ships: `npm run release` zips www/ into hosting/updates/bundle-<version>.zip
// and writes hosting/updates/version.json ({ version, url }); `firebase deploy --only hosting`
// publishes both. This module just polls that version.json on launch, and if it names a version
// newer than what's currently running, downloads the zip and queues it via next() — applied the
// next time the app backgrounds or restarts, so it never interrupts whatever the user is doing.
import { CapacitorUpdater } from "@capgo/capacitor-updater";

var MANIFEST_URL = "https://mister-lapkins.web.app/updates/version.json";

// The plugin's own default is to apply a queued (next()) bundle the moment the app so much as
// backgrounds — CapacitorUpdaterPlugin's appMovedToBackground() -> installNext() -> _reload(),
// which swaps the WebView's page and reloads it, with no config on our side ever asked for that.
// Opening the native camera for a device-check photo backgrounds the app just as much as
// switching to another app does, so mid-capture the WebView silently reloaded: JS state (which
// photo was pending, which tab was open) gone, the photo lost, and the next launch's
// NativeAudio.preload() throwing "Audio Asset already exists" — the native plugin registry
// survives a WebView-only reload even though the JS side starts completely over. setMultiDelay
// defers that. Called unconditionally on every startup (not only right after queuing a fresh
// download) so it also covers a bundle a previous session already queued but never got to apply.
//
// Originally just `{ kind: "kill" }` (wait for an actual process kill + relaunch) — on-device
// testing 2026-07-22 showed that's not a reliable trigger at all here: a queued update sat
// undelivered through many close/reopen cycles AND a full phone restart, never once applying.
// The plugin's own docs flag "kill" detection as currently unreliable/being reworked, which
// matches. Switched to `background` alone (2 minutes) — comfortably longer than a camera capture
// ever takes (what this delay exists to protect against, see above), but short enough that just
// leaving the app alone for a bit gets it updated, without depending on kill detection at all.
async function deferUpdatesUntilKill(){
  try{
    await CapacitorUpdater.setMultiDelay({ delayConditions: [{ kind: "background", value: "120000" }] });
  }catch(e){
    console.error("AppUpdater: setMultiDelay failed", e);
  }
}

async function checkForUpdate(){
  await deferUpdatesUntilKill();
  try{
    var res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if(!res.ok){ console.error("AppUpdater: manifest fetch failed", res.status); return; }
    var manifest = await res.json();
    if(!manifest || !manifest.version || !manifest.url){ console.error("AppUpdater: malformed manifest", manifest); return; }

    var current = await CapacitorUpdater.current();
    var currentVersion = current && current.bundle ? current.bundle.version : "";
    if(manifest.version === currentVersion) return; // already running the latest

    console.log("AppUpdater: new version available", currentVersion, "->", manifest.version);
    var bundle = await CapacitorUpdater.download({ version: manifest.version, url: manifest.url });
    await CapacitorUpdater.next({ id: bundle.id });
    console.log("AppUpdater: downloaded and queued", manifest.version, "— applies next relaunch/background");
  }catch(e){
    console.error("AppUpdater: update check failed", e);
  }
}

window.AppUpdater = {
  // Call as the very first thing in the app's init (before state load, rendering, anything else)
  // — the plugin assumes the bundle failed to boot and rolls back to the last good one if this
  // doesn't fire within appReadyTimeout (10s default), so it can't wait behind other startup work.
  notifyReady: function(){
    CapacitorUpdater.notifyAppReady().catch(function(e){ console.error("AppUpdater: notifyAppReady failed", e); });
  },
  // Call once the rest of startup is done — fire-and-forget, nothing in the app waits on it.
  checkForUpdate: checkForUpdate,
  // Temporary debug aid (see debugVersionLabel in index.html) — reports which bundle is actually
  // running, since an update queued via next() only takes effect on the relaunch after this one.
  getCurrentVersion: function(){ return CapacitorUpdater.current(); }
};
