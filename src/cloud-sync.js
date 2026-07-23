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
import { getAuth, GoogleAuthProvider, signInWithCredential, onIdTokenChanged, signOut as fbSignOut } from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp,
  collection, addDoc, updateDoc, deleteDoc, arrayUnion
} from "firebase/firestore";
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
var hasMeaningfulLocalStateFn = null;
var onSignInConflictFn = null;
var unsubscribeSnapshot = null;
var pushTimer = null;
var localEditCount = 0; // bumped on every local mutation (see queuePush) so an in-flight cloud
                         // fetch below can tell a local edit landed after it started and back off
var lastPushedEditCount = 0; // localEditCount as of the start of the most recent flushPush() —
                              // lets the onSnapshot listener below tell whether local state has
                              // moved ahead of what's actually been pushed (see startListening)
var freshSignInUid = null; // uid of a sign-in the user just explicitly requested (see signIn()),
                            // consumed by the very next onAuthStateChanged for that uid — see that
                            // listener for why loadOrSeedCloudState is only ever called from there

function userDocRef(uid){ return doc(db, "users", uid); }

// Firestore's setDoc() rejects (Unsupported field value: undefined) if the object it's given
// contains an `undefined` anywhere, even nested — unlike localStorage.setItem(JSON.stringify(...))
// elsewhere in the app, which silently drops undefined properties instead. state can pick up an
// undefined field (e.g. an optional property nothing ever set on an older task/habit), which
// localStorage happily swallows but Firestore does not. Round-tripping through JSON before it
// reaches setDoc() strips those the same way JSON.stringify already does for localStorage, so the
// two stores stay consistent instead of setDoc() throwing.
function sanitizeForFirestore(rawState){ return JSON.parse(JSON.stringify(rawState)); }

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
    // A local edit (e.g. unlocking a treasure from the gift box) can still be sitting in
    // queuePush()'s 1500ms debounce window, not yet pushed, when a genuine change from another
    // signed-in device arrives here. Applying it now would silently discard that edit from memory
    // before it ever reached Firestore — the reward popup already rendered from local state, but
    // the collection would revert underneath it. Our own pending push is about to supersede this
    // snapshot in Firestore anyway, so just skip applying it rather than clobber.
    if(localEditCount !== lastPushedEditCount) return;
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
//
// isFreshSignIn is only true when this fires right after the user just tapped "sign in" (see
// signIn() below) — never on session restore (onIdTokenChanged firing on app restart), since at that
// point the local state IS this account's state already and applying the cloud copy is a normal
// sync, not a competing set of progress. Only in the fresh-sign-in case do we risk silently
// discarding progress the user built up on this device before ever signing in — e.g. an account
// that already has data from another device — so that's the only case that goes through
// onSignInConflictFn instead of applying the cloud state outright.
function loadOrSeedCloudState(uid, isFreshSignIn){
  // TEMP diagnostic log — see the onIdTokenChanged listener above.
  console.log("Mister Lapkins: loadOrSeedCloudState start", uid, "isFreshSignIn:", isFreshSignIn);
  var editCountAtFetchStart = localEditCount;
  getDoc(userDocRef(uid)).then(function(snap){
    console.log("Mister Lapkins: loadOrSeedCloudState getDoc resolved, exists:", snap.exists());
    // getDoc() is a network round-trip — on a slow connection the user can add/edit something
    // locally (queuePush() bumps localEditCount) before it resolves. Applying what we fetched
    // would silently discard that edit; queuePush() already has it scheduled, so just let that
    // write win instead of racing it. Only guards the plain-restore path: the fresh-sign-in path
    // below already routes through hasMeaningfulLocalStateFn/onSignInConflictFn, which reads
    // local state fresh at prompt time anyway.
    if(!isFreshSignIn && localEditCount !== editCountAtFetchStart){
      startListening(uid);
      return;
    }
    if(snap.exists() && snap.data().appState){
      var cloudState = snap.data().appState;
      if(isFreshSignIn && onSignInConflictFn && hasMeaningfulLocalStateFn && hasMeaningfulLocalStateFn()){
        onSignInConflictFn(cloudState, {
          useCloud: function(){
            if(onRemoteStateFn) onRemoteStateFn(cloudState);
            startListening(uid);
          },
          useLocal: function(){
            if(getStateFn){
              setDoc(userDocRef(uid), { appState: sanitizeForFirestore(getStateFn()), updatedAt: serverTimestamp() })
                .catch(function(e){ console.warn("Mister Lapkins: cloud sync push (keep local) failed", e); });
            }
            startListening(uid);
          }
        });
        return;
      }
      if(onRemoteStateFn) onRemoteStateFn(cloudState);
    } else if(getStateFn){
      setDoc(userDocRef(uid), { appState: sanitizeForFirestore(getStateFn()), updatedAt: serverTimestamp() })
        .catch(function(e){ console.warn("Mister Lapkins: cloud sync seed failed", e); });
    }
    startListening(uid);
  }).catch(function(e){ console.warn("Mister Lapkins: cloud sync initial load failed", e); });
}

// The plugin's own cross-platform event — meant to fire reliably as soon as native sign-in
// completes, driving the UI (avatar/name/signed-out state) immediately regardless of anything
// below. Kept as a (harmless if redundant) secondary signal, but on-device testing on 2026-07-22
// showed it never firing even once across every sign-in attempt, on this exact native-plugin
// version/device combo — meaning currentUid never got set and the UI never left its signed-out
// state even once the JS SDK itself was correctly signed in underneath (see onIdTokenChanged
// below, which now drives both of those instead — proven reliable across every one of those
// same attempts). Left in case it's just this one device/plugin-version pairing and it does fire
// reliably elsewhere; if the "authStateChange" log below is genuinely never seen, it can go.
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
//
// signInWithCredential() below (inside signIn()) also fires THIS listener the moment it
// completes — Firebase notifies auth state observers for every transition, including ones your
// own code just caused — so this is also what actually drives the fresh-sign-in load, via
// freshSignInUid. It used to be a second, separate call from inside signIn() itself, guarded by a
// signInInFlight flag meant to suppress this listener while that call was in flight. That didn't
// work: the flag got cleared as soon as loadOrSeedCloudState() was *kicked off*, not once it (and
// whatever conflict dialog it opens) actually *finished* — since that call was fire-and-forget,
// not awaited. The dialog can sit on screen for seconds waiting for a tap, and this listener could
// still fire during that window with isFreshSignIn unset, silently overwriting local state with
// the cloud copy before the user's choice ever applied — so even tapping "keep this device's
// data" wrote back data that had already been clobbered. Routing every load through this single
// listener removes the second call site entirely, so there's nothing left to race.
//
// The stopListening() in the else branch matters for the same reason: it used to only happen in
// the native authStateChange listener above, not here. Firestore's SDK keeps an onSnapshot
// subscription alive and auto-resumes it the instant valid credentials reappear — it doesn't wait
// to be asked. So signing out and back into the same account (without this) left the OLD
// subscription attached; on the next sign-in it could deliver a snapshot of whatever was already
// in Firestore and silently overwrite local state via onRemoteStateFn before the conflict dialog
// even rendered, let alone before the user tapped "use this device's data" — same symptom as the
// double-call race above, different mechanism. Tearing the listener down on this (the JS SDK's
// own, authoritative) sign-out event, not just the native plugin's, closes that gap too.
//
// onAuthStateChanged(auth, ...) used to be what this was built on, per all the reasoning above —
// on-device diagnostic logging on 2026-07-22 showed it never firing at all after a successful
// signInWithCredential(), on this exact native-plugin + JS-SDK bridging combo, even though
// auth.currentUser was correctly set and Firebase's OWN onIdTokenChanged fired immediately and
// reliably for the same transition. Switched to onIdTokenChanged, which subsumes
// onAuthStateChanged's events (fires on sign-in/out plus routine token refreshes) — the
// lastHandledAuthUid guard below is what keeps a routine hourly token refresh from re-running
// loadOrSeedCloudState (and the full state-applying re-render that goes with it) for a session
// that's already loaded and already has its own live onSnapshot listener covering it.
//
// Also sets currentUid and calls onAuthChangeFn here now, not just in the native authStateChange
// listener above — that listener is what was originally meant to drive both of those (see its own
// comment), but on-device testing showed the exact same "never fires" problem for it too: the JS
// SDK side was correctly signed in the whole time, but currentUid stayed null (so queuePush()
// silently no-op'd on every edit — nothing was ever actually reaching Firestore) and the UI never
// left its signed-out state, since both only ever happened from that one unreliable event.
var lastHandledAuthUid = null;
onIdTokenChanged(auth, function(user){
  console.log("Mister Lapkins: onIdTokenChanged (auth) fired", user ? user.uid : null);
  currentUid = user ? user.uid : null;
  if(!user){
    lastHandledAuthUid = null;
    stopListening();
    if(onAuthChangeFn) onAuthChangeFn(null);
    return;
  }
  if(onAuthChangeFn) onAuthChangeFn(user);
  // Lets Kristina check "am I actually authenticated" straight from the Firestore console
  // (users/{uid}.lastSeenAt), independent of anything the app's own UI claims — worth having
  // given how unreliable that UI turned out to be during the 2026-07-22 sign-in debugging.
  // Deliberately just a timestamp, not an isOnline boolean: Firestore (unlike Realtime Database)
  // has no onDisconnect(), so a boolean would get stuck at "true" forever with no reliable event
  // to flip it back on app close/kill.
  setDoc(userDocRef(user.uid), { lastSeenAt: serverTimestamp() }, { merge: true }).catch(function(e){
    console.warn("Mister Lapkins: lastSeenAt write failed", e);
  });
  var isFresh = freshSignInUid === user.uid;
  freshSignInUid = null;
  if(!isFresh && lastHandledAuthUid === user.uid) return;
  lastHandledAuthUid = user.uid;
  loadOrSeedCloudState(user.uid, isFresh);
});

window.CloudSync = {
  init: function(options){
    getStateFn = options.getState;
    onRemoteStateFn = options.onRemoteState;
    onAuthChangeFn = options.onAuthChange;
    hasMeaningfulLocalStateFn = options.hasMeaningfulLocalState;
    onSignInConflictFn = options.onSignInConflict;
  },
  signIn: function(){
    FirebaseAuthentication.signInWithGoogle().then(function(result){
      console.log("Mister Lapkins: signInWithGoogle resolved", result && result.user && result.user.uid);
      var cred = result && result.credential;
      if(!cred || !cred.idToken){
        console.warn("Mister Lapkins: no credential/idToken from native sign-in, cloud sync won't authenticate");
        return;
      }
      // Must be set before signInWithCredential below — that's what actually fires the
      // onIdTokenChanged listener below reading this to know it's handling a fresh sign-in (see
      // that listener). The native result already carries the uid the JS SDK is about to sign in as.
      freshSignInUid = result.user.uid;
      var googleCredential = GoogleAuthProvider.credential(cred.idToken, cred.accessToken);
      return signInWithCredential(auth, googleCredential);
    }).catch(function(e){
      console.warn("Mister Lapkins: Google sign-in failed", e && e.code, e);
      freshSignInUid = null;
    });
  },
  signOut: function(){
    FirebaseAuthentication.signOut().catch(function(){});
    fbSignOut(auth).catch(function(){});
  },
  // Call after every local state mutation (see saveState) — debounced so a burst of
  // changes (typing, ticking checkboxes) collapses into one write instead of many.
  queuePush: function(){
    localEditCount++;
    if(!currentUid) return;
    if(pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(flushPush, 1500);
  }
};

// ---------- Shared shopping lists ("households") ----------
// Deliberately separate from the users/{uid} personal-state sync above: a household doc holds
// only { name, members: [uid, ...], createdAt } plus an items/ subcollection (one doc per
// shopping-list item), never the rest of appState. That keeps a shared list's writes (checking
// an item off, adding one) from ever touching — or racing with — a person's own private
// tasks/pantry/points sync. See the Firestore security rules for the matching access model:
// anyone signed in can fetch a household by id (the id itself acts as the invite code/link) but
// can only join it (append their own uid to members) or read/write its items once they're a
// member.
function householdDocRef(id){ return doc(db, "households", id); }
function householdItemsRef(id){ return collection(db, "households", id, "items"); }
function householdItemRef(householdId, itemId){ return doc(db, "households", householdId, "items", itemId); }

window.CloudSync.household = {
  getUid: function(){ return currentUid; },
  create: function(name){
    if(!currentUid) return Promise.reject(new Error("not-signed-in"));
    var ref = doc(collection(db, "households"));
    return setDoc(ref, { name: name, members: [currentUid], createdAt: serverTimestamp() })
      .then(function(){ return ref.id; });
  },
  getInfo: function(id){
    return getDoc(householdDocRef(id)).then(function(snap){
      return snap.exists() ? Object.assign({ id: snap.id }, snap.data()) : null;
    });
  },
  // Resolves with the household's info either way — including when this account was already a
  // member (rejoining via an old link shouldn't error, just confirm what's already true).
  join: function(id){
    if(!currentUid) return Promise.reject(new Error("not-signed-in"));
    return getDoc(householdDocRef(id)).then(function(snap){
      if(!snap.exists()) throw new Error("not-found");
      var data = snap.data();
      var members = data.members || [];
      if(members.indexOf(currentUid) !== -1) return Object.assign({ id: snap.id }, data);
      return updateDoc(householdDocRef(id), { members: arrayUnion(currentUid) })
        .then(function(){ return Object.assign({ id: snap.id }, data, { members: members.concat([currentUid]) }); });
    });
  },
  subscribeItems: function(householdId, onItems){
    return onSnapshot(householdItemsRef(householdId), function(snap){
      onItems(snap.docs.map(function(d){ return Object.assign({ id: d.id }, d.data()); }));
    }, function(err){ console.warn("Mister Lapkins: household items listener error", err); });
  },
  addItem: function(householdId, item){
    return addDoc(householdItemsRef(householdId), Object.assign(
      { checked: false, checkedBy: null, pantryId: null, createdAt: serverTimestamp() }, item
    ));
  },
  toggleItem: function(householdId, itemId, checked, uid){
    return updateDoc(householdItemRef(householdId, itemId), { checked: checked, checkedBy: checked ? uid : null });
  },
  renameItem: function(householdId, itemId, name){
    return updateDoc(householdItemRef(householdId, itemId), { name: name });
  },
  // Drag-and-drop reordering (see startCardDrag/endCardDrag + the shoppingItemList pointerdown
  // handler) — just the one field, same as toggleItem/renameItem, so two people dragging
  // different items at once never step on each other's writes (each is its own document).
  reorderItem: function(householdId, itemId, order){
    return updateDoc(householdItemRef(householdId, itemId), { order: order });
  },
  deleteItem: function(householdId, itemId){
    return deleteDoc(householdItemRef(householdId, itemId));
  }
};

function flushPush(){
  pushTimer = null;
  if(!currentUid || !getStateFn) return;
  lastPushedEditCount = localEditCount;
  setDoc(userDocRef(currentUid), { appState: sanitizeForFirestore(getStateFn()), updatedAt: serverTimestamp() }).catch(function(e){
    console.warn("Mister Lapkins: cloud sync push failed", e);
  });
}

// Android can freeze or fully kill the WebView's JS timers the instant the app leaves the
// foreground, so queuePush()'s 1500ms debounce may simply never fire — the edit that scheduled it
// (e.g. finishing/adding a task) never reaches Firestore. Next launch then does an ordinary
// session-restore fetch (see loadOrSeedCloudState/onIdTokenChanged above) and applies that
// stale cloud doc over local, silently rolling the app back to before the edit. Forcing the write
// out as soon as the app is about to stop being visible closes that window.
function flushPendingPush(){
  if(!pushTimer) return;
  clearTimeout(pushTimer);
  flushPush();
}
document.addEventListener("visibilitychange", function(){
  if(document.hidden) flushPendingPush();
});
document.addEventListener("pagehide", flushPendingPush);
