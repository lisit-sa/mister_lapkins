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

// "Busy" = actively typing (a focused text field) or looking at some open modal/sheet — same
// signals index.html's own isPaywallInterruptionSafe uses for its warning sheets, duplicated
// here (not imported/shared) since this module only ever talks to the rest of the app through
// window.AppUpdater and has no access to index.html's internals — it's cheap, plain DOM reads,
// not worth threading a callback through init() just to avoid repeating two lines.
function isSafeToApplyUpdate(){
  var active = document.activeElement;
  if(active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return false;
  if(document.querySelector(".modal-overlay.show")) return false;
  return true;
}

var RELOAD_RETRY_MS = 5000;

// Reload swaps the WebView's page (see CapacitorUpdater.reload's own effect) — this only ever
// gets called once a bundle is genuinely queued via next(), so it's safe to just keep retrying
// until a calm moment shows up; there's no real cost to checking every 5s.
function reloadWhenSafe(){
  if(isSafeToApplyUpdate()){
    console.log("AppUpdater: applying now");
    CapacitorUpdater.reload();
    return;
  }
  setTimeout(reloadWhenSafe, RELOAD_RETRY_MS);
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
    console.log("AppUpdater: downloaded and queued", manifest.version, "— applying once it's safe to interrupt");
    // Back to applying right away (via reloadWhenSafe) instead of waiting on the plugin's own
    // "apply on background" trigger — that trigger turned out unreliable on-device (2026-07-31:
    // a queued bundle sat undelivered through repeated background/foreground cycles, endlessly
    // re-downloaded and re-queued, never once installed — see the deferUpdatesUntilKill comment
    // above for the same behavior in more detail). Went to queue-and-wait-for-background instead
    // (2026-08-21) specifically to stop a reload from wiping an in-progress draft — but with
    // nothing actually forcing the apply, updates on a session that never backgrounds/restarts
    // just never land at all (reported 2026-08-23: deployed a real update, device never picked it
    // up). isSafeToApplyUpdate/reloadWhenSafe gets both: reliable, immediate-as-possible delivery
    // that still never interrupts someone mid-type or mid-modal.
    reloadWhenSafe();
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
