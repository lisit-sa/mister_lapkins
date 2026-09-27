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

window.AppCamera = {
  // Resolves the captured photo's webPath (a blob: URL the caller can fetch()+compress itself,
  // same shape index.html's existing compressImageToBase64 already expects from a File/Blob) —
  // or null if the user cancelled or the native call failed for any reason (permission denial,
  // no camera app, etc.). Never rejects, so callers don't need their own .catch just to handle
  // "nothing happened".
  takePhoto: function(){
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
    });
  }
};
