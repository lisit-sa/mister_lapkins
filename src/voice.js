// Voice input (speech-to-text) for text fields across the app — native
// @capacitor-community/speech-recognition on Android, Web Speech API fallback for the hosted PWA
// build (see package.json's "deploy" script, which puts this same www/ on firebase hosting too).
// Bundled with esbuild (see "build:voice") into www/voice.bundle.js, same convention as
// haptics.js/audioManager.js. Fully self-contained: it finds its own target fields by id, wraps
// each with a mic button, and wires everything up — nothing elsewhere needs to call into it.
import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { Capacitor } from "@capacitor/core";

var LANG = "ru-RU";
var isNative = Capacitor.isNativePlatform();
var WebSpeechCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
var webRecognizer = null;
// Native availability (device has a working recognizer at all) is only known after an async
// check; buttons stay visible-but-inert until init() resolves it, then unsupported ones hide.
var nativeAvailable = false;

// Only one field can dictate at a time (one microphone) — tracked here rather than per-button so
// starting a second field's mic cleanly stops whichever one was already listening.
var activeField = null;
var activeBtn = null;

var MIC_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/>'
  + '<path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 11Z"/>'
  + '</svg>';

// Every field that gets a mic button. Short/structured fields (icon pickers, join codes, numeric
// day counts, category names) are deliberately left out — dictation doesn't help those, and for
// categories specifically it's faster to just type/pick by hand (2026-07-31 feedback).
var TARGET_IDS = [
  "taskQuickInput", "addTaskTextarea", "taskTitleInput",
  "taskDetailTextarea", "taskDetailTitleInput",
  "shoppingItemAddInput", "shoppingListNewInput",
  "pantryNameInput", "habitNameInput", "homeCheckAddInput",
  "idlePhraseInput"
];

function isSupported(){
  return isNative ? nativeAvailable : !!WebSpeechCtor;
}

function insertTranscript(field, text){
  text = (text || "").trim();
  if(!text) return;
  var current = field.value;
  var needsSpace = current && !/\s$/.test(current);
  field.value = current + (needsSpace ? " " : "") + text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus();
}

function setRecordingUI(field, btn, on){
  if(btn) btn.classList.toggle("recording", on);
  if(field) field.classList.toggle("voice-field-listening", on);
}

function clearActive(){
  activeField = null;
  activeBtn = null;
}

function stopListening(){
  var field = activeField, btn = activeBtn;
  clearActive();
  setRecordingUI(field, btn, false);
  if(isNative){
    SpeechRecognition.stop().catch(function(){});
  } else if(webRecognizer){
    try{ webRecognizer.stop(); }catch(e){}
  }
}

// Failing silently here used to mean a dictation attempt that didn't work (no network — Android's
// native recognizer needs one — a denied permission, whatever) looked to the user exactly like a
// successful one that just transcribed nothing: no error, mic just stops, field stays as it was.
// A user reported writing a task by voice while offline that then "never got added" — it hadn't;
// there was nothing in the field to add. This surfaces that instead of swallowing it (2026-08-17).
function notifyFailure(){
  if(window.AppToast) window.AppToast.show("Не удалось распознать речь — проверь интернет и попробуй снова");
}

function startNative(field, btn){
  SpeechRecognition.requestPermissions().then(function(status){
    if(activeField !== field) return; // user tapped a different mic (or stopped) while we waited
    if(status.speechRecognition !== "granted"){
      clearActive();
      setRecordingUI(field, btn, false);
      return;
    }
    SpeechRecognition.start({ language: LANG, popup: false, partialResults: false, maxResults: 1 })
      .then(function(result){
        if(activeField !== field) return; // stopped/switched before this resolved
        var text = result && result.matches && result.matches[0];
        if(text) insertTranscript(field, text); else notifyFailure();
      })
      .catch(function(e){ console.error("AppVoice: native recognition failed", e); notifyFailure(); })
      .finally(function(){
        if(activeField === field) clearActive();
        setRecordingUI(field, btn, false);
      });
  }).catch(function(e){
    console.error("AppVoice: permission request failed", e);
    if(activeField === field) clearActive();
    setRecordingUI(field, btn, false);
  });
}

function startWeb(field, btn){
  if(!webRecognizer) webRecognizer = new WebSpeechCtor();
  webRecognizer.lang = LANG;
  webRecognizer.interimResults = false;
  webRecognizer.maxAlternatives = 1;
  webRecognizer.onresult = function(e){
    var alt = e.results && e.results[0] && e.results[0][0];
    insertTranscript(field, alt && alt.transcript);
  };
  webRecognizer.onerror = function(e){ console.error("AppVoice: web recognizer error", e.error); };
  webRecognizer.onend = function(){
    if(activeField === field) clearActive();
    setRecordingUI(field, btn, false);
  };
  try{
    webRecognizer.start();
  }catch(e){
    console.error("AppVoice: web recognizer start failed", e);
    clearActive();
    setRecordingUI(field, btn, false);
  }
}

function toggleListening(field, btn){
  if(activeField === field){ stopListening(); return; }
  if(activeField) stopListening();
  if(!isSupported()) return;
  activeField = field;
  activeBtn = btn;
  setRecordingUI(field, btn, true);
  if(isNative) startNative(field, btn); else startWeb(field, btn);
}

function attach(field){
  if(!field || field.closest(".voice-field-wrap")) return;
  var wrap = document.createElement("div");
  wrap.className = "voice-field-wrap" + (field.tagName === "TEXTAREA" ? " voice-field-multiline" : "");
  field.parentNode.insertBefore(wrap, field);
  wrap.appendChild(field);
  field.classList.add("voice-field-input");

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "voice-mic-btn" + (isSupported() ? "" : " unsupported");
  btn.setAttribute("aria-label", "Голосовой ввод");
  btn.innerHTML = MIC_SVG;
  wrap.appendChild(btn);

  btn.addEventListener("click", function(e){
    e.preventDefault();
    e.stopPropagation();
    toggleListening(field, btn);
  });
}

function refreshUnsupported(){
  document.querySelectorAll(".voice-mic-btn").forEach(function(btn){
    btn.classList.toggle("unsupported", !isSupported());
  });
}

function init(){
  TARGET_IDS.forEach(function(id){
    var el = document.getElementById(id);
    if(el) attach(el);
  });
  if(isNative){
    SpeechRecognition.available().then(function(r){
      nativeAvailable = !!r.available;
      refreshUnsupported();
    }).catch(function(e){
      console.error("AppVoice: availability check failed", e);
      nativeAvailable = false;
      refreshUnsupported();
    });
  }
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
}else{
  init();
}
