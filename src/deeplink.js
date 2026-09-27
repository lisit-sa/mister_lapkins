// Join-list deep link + widget quick-add deep link — bundled with esbuild (see package.json's
// "build:deeplink" script) into www/deeplink.bundle.js, same convention as cloud-sync.js/
// audioManager.js etc. Talks to the rest of the (unbundled) app only through window.AppDeepLink.
import { App } from "@capacitor/app";

var onJoinCodeFn = null;
var onWidgetActionFn = null;

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

// misterlapkins://open?action=add-task|add-shopping|edit-task|edit-shopping[&id=...][&listId=...]
// — the widget's add buttons and, since 2026-09-17, its per-row pencil (see
// MrLapkinsWidgetProvider.java/handleRowClick and AndroidManifest.xml's host="open" data element).
// Same custom scheme as the join link, different host, so it's disambiguated here rather than
// needing its own intent-filter/listener.
function extractWidgetAction(url){
  try{
    var parsed = new URL(url);
    if(parsed.protocol !== "misterlapkins:" || parsed.hostname !== "open") return null;
    return {
      action: parsed.searchParams.get("action"),
      id: parsed.searchParams.get("id"),
      listId: parsed.searchParams.get("listId")
    };
  }catch(e){
    return null;
  }
}

// Fires both for a cold start via this link (app wasn't running) and for an already-running app
// (singleTask launchMode routes it through onNewIntent instead of a fresh onCreate) — Capacitor's
// BridgeActivity forwards either case as the same appUrlOpen event, no need to tell them apart here.
App.addListener("appUrlOpen", function(data){
  var url = data && data.url;
  if(!url) return;
  var code = extractJoinCode(url);
  if(code && onJoinCodeFn){ onJoinCodeFn(code); return; }
  var widget = extractWidgetAction(url);
  if(widget && widget.action && onWidgetActionFn) onWidgetActionFn(widget.action, widget.id, widget.listId);
});

window.AppDeepLink = {
  init: function(onJoinCode, onWidgetAction){
    onJoinCodeFn = onJoinCode;
    onWidgetActionFn = onWidgetAction;
  }
};
