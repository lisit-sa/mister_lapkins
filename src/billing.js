// RevenueCat wrapper for Google Play Billing (subscriptions) — bundled with esbuild (see
// package.json's "build:billing" script) into www/billing.bundle.js, same convention as
// cloud-sync.js/updater.js/notifications.js. Talks to the rest of the (unbundled) app only
// through window.AppBilling.
import { Purchases, LOG_LEVEL } from "@revenuecat/purchases-capacitor";

// Public SDK key for this app's RevenueCat "Google Play" app entry — safe to embed in client
// code, same as Firebase's own apiKey already shipped in google-services.json (RevenueCat's
// public keys are scoped read/purchase-only, can't access anything privileged; the actual
// secret key, if we ever need one server-side, never goes in this file).
var API_KEY = "goog_JBsSdFmtKuQnCgQfMTBgdZkrIaY";

// Matches the Entitlement identifier created in the RevenueCat dashboard (Product Catalog →
// Entitlements → "Mr. Lapkins Unlimited") — whoever holds this, trial or paid, is unlocked.
var ENTITLEMENT_ID = "mr_lapkins_unlimited";

var configured = false;
var onStatusChangeFn = null;

function isEntitledFromInfo(customerInfo){
  return !!(customerInfo && customerInfo.entitlements && customerInfo.entitlements.active && customerInfo.entitlements.active[ENTITLEMENT_ID]);
}

async function init(){
  if(configured) return;
  configured = true;
  try{
    await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
    await Purchases.configure({ apiKey: API_KEY });
    console.log("AppBilling: configured");
    // Fires on every entitlement change RevenueCat becomes aware of — a purchase completing, a
    // trial converting to paid, a renewal, an expiry — not just ones this session directly
    // caused. Lets the paywall gate react live (see index.html) instead of only re-checking on
    // next app launch.
    Purchases.addCustomerInfoUpdateListener(function(customerInfo){
      if(onStatusChangeFn) onStatusChangeFn(isEntitledFromInfo(customerInfo));
    });
  }catch(e){
    console.error("AppBilling: configure failed", e);
  }
}

// Ties the RevenueCat customer to this Firebase account (instead of an anonymous per-device id)
// so a subscription bought on one device is recognized on every device signed into the same
// Google account — call once uid is known (see updateAccountUI in index.html).
async function identify(uid){
  if(!uid) return;
  try{
    await Purchases.logIn({ appUserID: uid });
    console.log("AppBilling: identified", uid);
  }catch(e){
    console.error("AppBilling: logIn failed", e);
  }
}

// Reverts to an anonymous RevenueCat id on sign-out — mirrors identify, called from the same
// place updateAccountUI handles the signed-out case.
async function signOut(){
  try{
    await Purchases.logOut();
  }catch(e){
    // Throws if already anonymous (nothing to log out of) — harmless, matches RevenueCat's own
    // documented behavior here.
  }
}

// One-shot check — the paywall gate's own render calls this; addCustomerInfoUpdateListener
// above (see init) is what keeps it from going stale without a full re-check every time.
// Returns null (not false) if the check itself failed, so the caller can tell "confirmed not
// entitled" apart from "couldn't ask" — same reasoning as fetchGrandfatheredEmails in
// cloud-sync.js.
async function isEntitled(){
  try{
    var result = await Purchases.getCustomerInfo();
    return isEntitledFromInfo(result && result.customerInfo);
  }catch(e){
    console.error("AppBilling: getCustomerInfo failed", e);
    return null;
  }
}

// Raw { monthly, annual } Package objects from the "default" Offering's current packages (see
// RevenueCat dashboard — $rc_monthly/$rc_annual). Either can be null if that package isn't
// configured or offerings failed to load; null overall means the fetch itself failed. Deliberately
// returns the SDK's own Package objects rather than a re-shaped price/label object — purchasePackage
// below needs the original object back, and the paywall screen reads .product.priceString itself
// for display, so there's nothing this module can usefully pre-format without guessing at copy.
async function getOfferingPackages(){
  try{
    var result = await Purchases.getOfferings();
    var current = result && result.current;
    if(!current) return null;
    return { monthly: current.monthly || null, annual: current.annual || null };
  }catch(e){
    console.error("AppBilling: getOfferings failed", e);
    return null;
  }
}

// aPackage is one of the Package objects getOfferingPackages returned. Resolves to the fresh
// isEntitled() result on success (the customerInfo the purchase call itself returns already
// reflects it, no need for a second round trip); rejects on failure OR user cancellation — the
// SDK reports a cancelled purchase sheet as a rejected promise with userCancelled:true on the
// error, which the caller (paywall UI) should check for to distinguish "they backed out" from
// "something actually broke".
async function purchasePackage(aPackage){
  var result = await Purchases.purchasePackage({ aPackage: aPackage });
  return isEntitledFromInfo(result && result.customerInfo);
}

async function restorePurchases(){
  try{
    var result = await Purchases.restorePurchases();
    return isEntitledFromInfo(result && result.customerInfo);
  }catch(e){
    console.error("AppBilling: restorePurchases failed", e);
    return null;
  }
}

window.AppBilling = {
  init: init,
  identify: identify,
  signOut: signOut,
  isEntitled: isEntitled,
  getOfferingPackages: getOfferingPackages,
  purchasePackage: purchasePackage,
  restorePurchases: restorePurchases,
  // fn(isEntitled: boolean) — see the addCustomerInfoUpdateListener call in init.
  onStatusChange: function(fn){ onStatusChangeFn = fn; }
};
