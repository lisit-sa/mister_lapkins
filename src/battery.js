// Bridges to BatteryOptimizationPlugin.java (android/app/src/main/java/com/lisitsa/misterlapkins/)
// — a small LOCAL native plugin, not an npm package, so there's no dedicated wrapper to import;
// registerPlugin() from @capacitor/core is the standard way to reach a plugin like that from web
// code. Bundled with esbuild (see package.json's "build:battery" script) into
// www/battery.bundle.js, the same convention the other native-plugin modules use. Talks to the
// rest of the (non-module, unbundled) app only through window.AppBattery.
import { registerPlugin } from "@capacitor/core";

var BatteryOptimization = registerPlugin("BatteryOptimization");

window.AppBattery = {
  // Resolves false on iOS/web (no such native plugin there) rather than rejecting, so callers can
  // treat "no answer" the same as "already fine, nothing to ask" without a .catch of their own.
  isIgnoringOptimizations: function(){
    return BatteryOptimization.isIgnoringOptimizations().then(function(r){ return !!(r && r.ignoring); }).catch(function(){ return true; });
  },
  requestIgnoreOptimizations: function(){
    return BatteryOptimization.requestIgnoreOptimizations().catch(function(e){
      console.warn("AppBattery: requestIgnoreOptimizations failed", e);
    });
  }
};
