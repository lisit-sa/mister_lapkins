// Haptic feedback (vibration) via the official @capacitor/haptics plugin — bundled with esbuild
// (see package.json's "build:haptics" script) into www/haptics.bundle.js, the same convention
// cloud-sync.js/audioManager.js/updater.js use. Talks to the rest of the (non-module, unbundled)
// app only through window.AppHaptics.
//
// Its own independent mute flag (separate localStorage key from AudioManager's) so sound and
// vibration can be turned off independently, as asked for — see the "Вибрация" toggle in the
// settings sidebar.
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

var DISABLED_STORAGE_KEY = "mr_lapkins_haptics_disabled";
var disabled = readDisabledFromStorage();

function readDisabledFromStorage(){
  try{
    return localStorage.getItem(DISABLED_STORAGE_KEY) === "1";
  }catch(e){
    return false; // localStorage unavailable — default to haptics on
  }
}

function writeDisabledToStorage(value){
  try{
    localStorage.setItem(DISABLED_STORAGE_KEY, value ? "1" : "0");
  }catch(e){
    console.error("AppHaptics: failed to persist disabled state", e);
  }
}

// Every actual vibration goes through here — swallows any plugin/platform error (e.g. a desktop
// browser with no vibrate API) so haptic feedback can never break the tap that triggered it.
function fire(callHaptics){
  if(disabled) return;
  callHaptics().catch(function(e){ console.error("AppHaptics: failed", e); });
}

window.AppHaptics = {
  light: function(){ fire(function(){ return Haptics.impact({ style: ImpactStyle.Light }); }); },
  medium: function(){ fire(function(){ return Haptics.impact({ style: ImpactStyle.Medium }); }); },
  heavy: function(){ fire(function(){ return Haptics.impact({ style: ImpactStyle.Heavy }); }); },
  success: function(){ fire(function(){ return Haptics.notification({ type: NotificationType.Success }); }); },
  warning: function(){ fire(function(){ return Haptics.notification({ type: NotificationType.Warning }); }); },
  error: function(){ fire(function(){ return Haptics.notification({ type: NotificationType.Error }); }); },
  isDisabled: function(){ return disabled; },
  setDisabled: function(value){
    disabled = !!value;
    writeDisabledToStorage(disabled);
  }
};
