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
// defers that.
//
// Originally just `{ kind: "kill" }` (wait for an actual process kill + relaunch) — on-device
// testing 2026-07-22 showed that's not a reliable trigger at all here: a queued update sat
// undelivered through many close/reopen cycles AND a full phone restart, never once applying.
// The plugin's own docs flag "kill" detection as currently unreliable/being reworked, which
// matches. Switched to `background` (2 minutes) instead.
//
// IMPORTANT, found the hard way twice now: a setMultiDelay condition only ever protects the ONE
// background dip that happens after it's set. The very next time the app returns to the
// foreground — regardless of whether the delay actually elapsed — the plugin logs "All delays
// canceled from checkCancelDelay" and drops the condition entirely; per the plugin's own
// cancelDelay() docs, that means the pending update "will be applied on the next app background
// or restart", unconditionally, no matter how brief. So:
// - Calling this ONCE at startup (in checkForUpdate below) only protects the very first bg/fg
//   dip of the session — a *second* photo taken later in the same session sailed straight
//   through with no protection at all, which is the original bug this file was written to fix.
// - The "obvious" fix — re-arming this on every single foreground resume via
//   App.addListener("appStateChange", ...) — was tried 2026-07-26 and made things *worse* in the
//   opposite direction: since checkCancelDelay clears the condition on literally every
//   foreground regardless of elapsed time, re-arming a fresh one immediately after just means
//   there's *always* an unexpired condition in place by the time the next backgrounding is
//   checked — the update can then never apply at all, not even after the app sits genuinely idle
//   in the background for hours (confirmed on-device: 10+ launches over 20 hours, all stuck on
//   the native "1.0" bundle).
// The actual fix: only re-arm right before the ONE specific native-intent action known to risk
// this (opening the camera — see openCameraForDevice's call to AppUpdater.deferForCameraCapture),
// not on every foreground. Everything else goes through the plugin's normal default behavior
// (apply on next background) once whatever delay was last armed has been cleared.
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
    console.log("AppUpdater: downloaded and queued", manifest.version, "— applies on next background/restart");
    // Used to call CapacitorUpdater.reload() right here to apply immediately, because on-device
    // testing 2026-07-31 found the plugin's own "apply on background" trigger unreliable — a
    // queued bundle sat undelivered through repeated background/foreground cycles, re-downloaded
    // and re-queued forever, never installed. That traded a different problem in: checkForUpdate
    // runs early in startup, but the fetch+download over the network can easily take long enough
    // that someone's already mid-typing a task by the time it resolves — the forced reload wiped
    // that draft with no warning (reported 2026-08-21). Back to queue-and-wait: an update no
    // longer interrupts an open session, but if bundles start silently not landing again, this
    // background trigger being flaky is the known suspect — see the deferUpdatesUntilKill comment
    // below for the same plugin behavior in more detail.
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
  // Call right before deliberately backgrounding the app for a native intent that must survive
  // (currently just openCameraForDevice) — see the long comment above deferUpdatesUntilKill for
  // why this can't just run once at startup or on every foreground instead.
  deferForCameraCapture: deferUpdatesUntilKill,
  // Temporary debug aid (see debugVersionLabel in index.html) — reports which bundle is actually
  // running, since an update queued via next() only takes effect on the relaunch after this one.
  getCurrentVersion: function(){ return CapacitorUpdater.current(); }
};
