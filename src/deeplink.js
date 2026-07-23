// Join-list deep link — bundled with esbuild (see package.json's "build:deeplink" script) into
// www/deeplink.bundle.js, same convention as cloud-sync.js/audioManager.js etc. Talks to the
// rest of the (unbundled) app only through window.AppDeepLink.
import { App } from "@capacitor/app";

var onJoinCodeFn = null;

// Two link shapes reach here, both carrying the code as a "code" query param:
//   - misterlapkins://join?code=XXXX (custom scheme, host is "join") — the original link shape,
//     kept working for any already-shared links.
//   - https://mister-lapkins.web.app/join?code=XXXX (verified App Link) — what's actually shared
//     now, since this is the shape that shows up as a tappable link in WhatsApp/Telegram/etc.
function extractJoinCode(url){
  try{
    var parsed = new URL(url);
    var isCustomScheme = parsed.protocol === "misterlapkins:" && parsed.hostname === "join";
    var isAppLink = parsed.protocol === "https:" && parsed.pathname === "/join";
    if(!isCustomScheme && !isAppLink) return null;
    return parsed.searchParams.get("code");
  }catch(e){
    return null;
  }
}

// Fires both for a cold start via this link (app wasn't running) and for an already-running app
// (singleTask launchMode routes it through onNewIntent instead of a fresh onCreate) — Capacitor's
// BridgeActivity forwards either case as the same appUrlOpen event, no need to tell them apart here.
App.addListener("appUrlOpen", function(data){
  var code = data && data.url ? extractJoinCode(data.url) : null;
  if(code && onJoinCodeFn) onJoinCodeFn(code);
});

window.AppDeepLink = {
  init: function(onJoinCode){
    onJoinCodeFn = onJoinCode;
  }
};
