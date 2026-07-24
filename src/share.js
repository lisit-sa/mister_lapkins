// Native share sheet via the official @capacitor/share plugin — bundled with esbuild (see
// package.json's "build:share" script) into www/share.bundle.js, the same convention
// cloud-sync.js/audioManager.js/haptics.js use. Talks to the rest of the (non-module, unbundled)
// app only through window.NativeShare.
//
// Replaces a bare navigator.share() call (see nativeShareListCode in index.html) — the Web Share
// API is missing entirely in some Android WebView builds (confirmed on a MIUI/Xiaomi device: it
// silently falls back to clipboard-copy instead of opening a share sheet, even though
// navigator.clipboard on the same WebView works fine). @capacitor/share goes through Android's
// native ACTION_SEND intent chooser directly, sidestepping whatever the WebView does or doesn't
// implement.
import { Share } from "@capacitor/share";

window.NativeShare = {
  share: function(text){
    return Share.share({ text: text }).catch(function(e){
      console.error("NativeShare: share failed", e);
    });
  }
};
