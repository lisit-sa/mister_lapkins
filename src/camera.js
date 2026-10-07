// Real native camera via the official @capacitor/camera plugin — bundled with esbuild (see
// package.json's "build:camera" script) into www/camera.bundle.js, same convention as the other
// native-plugin modules. Talks to the rest of the (non-module, unbundled) app only through
// window.AppCamera.
//
// Replaces the old <input type="file" capture="environment"> WebView file-chooser mechanism
// (2026-09-27) — that one couldn't be triggered reliably from a "Контроль дома" widget tap:
// Chrome/WebView requires a file chooser to be opened by a genuine, recent touch event inside the
// page itself ("transient user activation"), and a tap on the home-screen widget happens in the
// launcher's own window, never inside our WebView at all — so deviceCameraInput.click() there
// silently failed with "File chooser dialog can only be shown with a user activation." A native
// camera call like this one goes through Android's own startActivityForResult instead, which only
// needs the calling Activity to be resumed (already true by the time the widget's deep link opens
// MainActivity) — no WebView-specific gesture requirement at all.
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { App } from "@capacitor/app";

// HyperOS's "camera boost" (camopt_killer) kills background apps the moment the camera opens —
// including this one, confirmed in logcat 2026-10-07 — so the photo comes back to a brand-new
// process whose takePhoto() promise no longer exists. Capacitor still delivers it, as an
// appRestoredResult event; this key carries what the caller needs to finish the job (which device
// the photo was for) across that process death, since nothing in memory survives it.
var PENDING_KEY = "appCameraPendingCapture";
var PENDING_MAX_AGE_MS = 10 * 60 * 1000;

function savePending(context){
  try{ localStorage.setItem(PENDING_KEY, JSON.stringify({ context: context || null, at: Date.now() })); }catch(e){}
}

function takePending(){
  try{
    var raw = localStorage.getItem(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY);
    var pending = raw ? JSON.parse(raw) : null;
    if(!pending || Date.now() - pending.at > PENDING_MAX_AGE_MS) return null;
    return pending;
  }catch(e){
    return null;
  }
}

var restoredHandler = null;
var restoredQueue = [];

App.addListener("appRestoredResult", function(event){
  if(!event || event.pluginId !== "Camera") return;
  var pending = takePending();
  var webPath = (event.success && event.data && event.data.webPath) ? event.data.webPath : null;
  var item = { webPath: webPath, context: pending ? pending.context : null };
  if(restoredHandler) restoredHandler(item.webPath, item.context);
  else restoredQueue.push(item);
});

window.AppCamera = {
  // Resolves the captured photo's webPath (a blob: URL the caller can fetch()+compress itself,
  // same shape index.html's existing compressImageToBase64 already expects from a File/Blob) —
  // or null if the user cancelled or the native call failed for any reason (permission denial,
  // no camera app, etc.). Never rejects, so callers don't need their own .catch just to handle
  // "nothing happened".
  // context: whatever the caller needs to finish handling the photo if the app gets killed while
  // the camera is open — handed back to onRestoredPhoto's handler in that case (see PENDING_KEY).
  takePhoto: function(context){
    savePending(context);
    return Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      saveToGallery: false
    }).then(function(photo){
      return (photo && photo.webPath) ? photo.webPath : null;
    }).catch(function(e){
      // Cancelling the camera also rejects (message along the lines of "User cancelled photos
      // app") — not a real error, just means there's no photo to save this time.
      console.warn("AppCamera: takePhoto failed/cancelled", e && e.message);
      return null;
    }).then(function(webPath){
      takePending();
      return webPath;
    });
  },
  // handler(webPath|null, context) — called for a photo taken by a previous, killed process (see
  // PENDING_KEY). Results that arrived before this was registered are replayed right away.
  onRestoredPhoto: function(handler){
    restoredHandler = handler;
    var queued = restoredQueue;
    restoredQueue = [];
    queued.forEach(function(item){ handler(item.webPath, item.context); });
  }
};
