// Cloud sync (Google sign-in + Firestore) — bundled with esbuild (see package.json's
// "build:cloudsync" script) into www/cloud-sync.bundle.js, a plain classic script with no
// `import`/`export` left in it. Loading these packages via a CDN <script type="module"> was
// tried first, but @capacitor-firebase/authentication's browser build didn't reliably bridge
// to the native Android plugin inside the WebView; bundling through npm — the way Capacitor
// itself expects plugins to be consumed — avoids that entirely.
//
// Talks to the rest of the (non-module, unbundled) app only through window.CloudSync, since
// index.html's main script is a classic script and can't itself use `import`.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCredential, onAuthStateChanged, signOut as fbSignOut } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";

var firebaseConfig = {
  apiKey: "AIzaSyAhdMBjwnI5r4gpLdzcogppHu1iCNtnUSU",
  authDomain: "mister-lapkins.firebaseapp.com",
  projectId: "mister-lapkins",
  storageBucket: "mister-lapkins.firebasestorage.app",
  messagingSenderId: "687434243745",
  appId: "1:687434243745:web:75f645846829e11adf9ae0"
};

var app = initializeApp(firebaseConfig);
var auth = getAuth(app);
var db = getFirestore(app);

var currentUid = null;
var listeningUid = null; // which uid startListening() is currently attached to, so we don't double-attach
var getStateFn = null;
var onRemoteStateFn = null;
var onAuthChangeFn = null;
var unsubscribeSnapshot = null;
var pushTimer = null;

function userDocRef(uid){ return doc(db, "users", uid); }

function startListening(uid){
  if(listeningUid === uid) return;
  if(unsubscribeSnapshot) unsubscribeSnapshot();
  listeningUid = uid;
  unsubscribeSnapshot = onSnapshot(userDocRef(uid), function(snap){
    // hasPendingWrites means this snapshot is our own optimistic write echoing back, not a
    // genuine change from the server/another device — applying it again would be a no-op
    // at best and a wasted re-render at worst.
    if(snap.metadata.hasPendingWrites) return;
    if(!snap.exists()) return;
    var data = snap.data();
    if(data && data.appState && onRemoteStateFn) onRemoteStateFn(data.appState);
  }, function(err){ console.warn("Mister Lapkins: cloud sync listener error", err); });
}

function stopListening(){
  if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
  listeningUid = null;
}

// Loads (or seeds) this account's cloud document — only safe to call once the Firebase JS SDK
// itself (not just the native plugin) actually has a signed-in user, since that's what
// Firestore's security rules check (request.auth.uid). See the long comment on
// ensureJsSdkSignedIn below for why that's not automatic.
function loadOrSeedCloudState(uid){
  getDoc(userDocRef(uid)).then(function(snap){
    if(snap.exists() && snap.data().appState){
      if(onRemoteStateFn) onRemoteStateFn(snap.data().appState);
    } else if(getStateFn){
      setDoc(userDocRef(uid), { appState: getStateFn(), updatedAt: serverTimestamp() });
    }
    startListening(uid);
  }).catch(function(e){ console.warn("Mister Lapkins: cloud sync initial load failed", e); });
}

// The plugin's own cross-platform event — fires reliably as soon as native sign-in completes,
// so it drives the UI (avatar/name/signed-out state) immediately regardless of anything below.
FirebaseAuthentication.addListener("authStateChange", function(change){
  var user = change.user;
  console.log("Mister Lapkins: authStateChange", user ? user.uid : null);
  currentUid = user ? user.uid : null;
  if(!user) stopListening();
  if(onAuthChangeFn) onAuthChangeFn(user);
});

// Separate from authStateChange on purpose: this is the Firebase JS SDK's OWN auth state, which
// is what Firestore actually checks against its security rules (request.auth.uid) — it is a
// different session from the native one above, and with this plugin it is NOT reliably kept in
// sync automatically despite `skipNativeAuth:false`. Confirmed on-device: native sign-in
// completed (showed up in Authentication > Users) but nothing ever landed in Firestore, with no
// visible error, because the JS SDK side never actually signed in, so every Firestore call was
// silently rejected by the security rules as unauthenticated. signIn() below explicitly bridges
// the two with signInWithCredential; this listener is the fallback that catches an already-
// persisted JS SDK session on app restart.
onAuthStateChanged(auth, function(user){
  if(user) loadOrSeedCloudState(user.uid);
});

window.CloudSync = {
  init: function(options){
    getStateFn = options.getState;
    onRemoteStateFn = options.onRemoteState;
    onAuthChangeFn = options.onAuthChange;
  },
  signIn: function(){
    FirebaseAuthentication.signInWithGoogle().then(function(result){
      console.log("Mister Lapkins: signInWithGoogle resolved", result && result.user && result.user.uid);
      var cred = result && result.credential;
      if(!cred || !cred.idToken){
        console.warn("Mister Lapkins: no credential/idToken from native sign-in, cloud sync won't authenticate");
        return;
      }
      var googleCredential = GoogleAuthProvider.credential(cred.idToken, cred.accessToken);
      return signInWithCredential(auth, googleCredential).then(function(jsResult){
        console.log("Mister Lapkins: JS SDK signed in for Firestore", jsResult.user.uid);
        loadOrSeedCloudState(jsResult.user.uid);
      });
    }).catch(function(e){
      console.warn("Mister Lapkins: Google sign-in failed", e);
    });
  },
  signOut: function(){
    FirebaseAuthentication.signOut().catch(function(){});
    fbSignOut(auth).catch(function(){});
  },
  // Call after every local state mutation (see saveState) — debounced so a burst of
  // changes (typing, ticking checkboxes) collapses into one write instead of many.
  queuePush: function(){
    if(!currentUid) return;
    if(pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(flushPush, 1500);
  }
};

function flushPush(){
  pushTimer = null;
  if(!currentUid || !getStateFn) return;
  setDoc(userDocRef(currentUid), { appState: getStateFn(), updatedAt: serverTimestamp() }).catch(function(e){
    console.warn("Mister Lapkins: cloud sync push failed", e);
  });
}
