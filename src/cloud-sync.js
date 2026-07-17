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
import { getAuth, onAuthStateChanged, signOut as fbSignOut } from "firebase/auth";
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
var getStateFn = null;
var onRemoteStateFn = null;
var onAuthChangeFn = null;
var unsubscribeSnapshot = null;
var pushTimer = null;

function userDocRef(uid){ return doc(db, "users", uid); }

function startListening(uid){
  if(unsubscribeSnapshot) unsubscribeSnapshot();
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
}

onAuthStateChanged(auth, function(user){
  currentUid = user ? user.uid : null;
  if(user){
    // First time this account is seen on this device: pull whatever's already in the
    // cloud, or if there's nothing there yet, seed the cloud from this device's local
    // (pre-sign-in) state so nothing the user already made gets lost.
    getDoc(userDocRef(user.uid)).then(function(snap){
      if(snap.exists() && snap.data().appState){
        if(onRemoteStateFn) onRemoteStateFn(snap.data().appState);
      } else if(getStateFn){
        setDoc(userDocRef(user.uid), { appState: getStateFn(), updatedAt: serverTimestamp() });
      }
      startListening(user.uid);
    });
  } else {
    stopListening();
  }
  if(onAuthChangeFn) onAuthChangeFn(user);
});

function flushPush(){
  pushTimer = null;
  if(!currentUid || !getStateFn) return;
  setDoc(userDocRef(currentUid), { appState: getStateFn(), updatedAt: serverTimestamp() }).catch(function(e){
    console.warn("Mister Lapkins: cloud sync push failed", e);
  });
}

window.CloudSync = {
  init: function(options){
    getStateFn = options.getState;
    onRemoteStateFn = options.onRemoteState;
    onAuthChangeFn = options.onAuthChange;
  },
  signIn: function(){
    FirebaseAuthentication.signInWithGoogle().catch(function(e){
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
