// Sound effects (ASMR clicks, rustles, cat sounds) via @capacitor-community/native-audio —
// bundled with esbuild (see package.json's "build:audio" script) into www/audio-manager.bundle.js,
// a plain classic script with no `import`/`export` left in it, the same convention cloud-sync.js
// uses. Talks to the rest of the (non-module, unbundled) app only through window.AudioManager,
// since index.html's main script is a classic script and can't itself use `import`.
import { NativeAudio } from "@capacitor-community/native-audio";

// On Android, NativeAudio reads preloaded assets straight off AssetManager at
// android/app/src/main/assets/<assetPath> — NOT wherever `cap sync` copies www/ to. The files
// still need to live at www/assets/sounds/*.mp3 too (that's what the web/browser fallback reads,
// and it's the source scripts/sync-sounds.js mirrors from) — but adding/changing a sound file
// means running `npm run sync` (mirrors them into the native assets folder) and rebuilding the
// APK, same as icons: sounds are native content and the OTA updater can't deliver them.
var SOUNDS = {
  click: "assets/sounds/click.wav",
  card_open: "assets/sounds/card_open.wav",
  delete: "assets/sounds/delete.wav",
  give_a_box: "assets/sounds/give_a_box.wav",
  purr: "assets/sounds/purr.mp3",
  // Reminder-sound picker options (see previewReminderSound below and the picker page in
  // index.html) — curated files a user dropped into www/sounds/alarm/, synced here flat by
  // scripts/sync-sounds.js. Keep in sync with TASK_REMINDER_SOUNDS in src/notifications.js.
  fairy_tail_happy: "assets/sounds/fairy_tail_happy.mp3",
  last_magic: "assets/sounds/last_magic.mp3",
  magic: "assets/sounds/magic.mp3",
  magical_classic: "assets/sounds/magical_classic.mp3",
  thank_you: "assets/sounds/thank_you.mp3",
  the_magic_knights: "assets/sounds/the_magic_knights.mp3",
  violin: "assets/sounds/violin.mp3",
  violin_music: "assets/sounds/violin_music.mp3"
};

var MUTE_STORAGE_KEY = "mr_lapkins_sound_muted";
var preloadedIds = {}; // assetId -> true once preload() has resolved, so play() can skip re-preloading
var muted = readMutedFromStorage();

function readMutedFromStorage(){
  try{
    return localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  }catch(e){
    return false; // localStorage unavailable (e.g. private mode) — default to sound on
  }
}

function writeMutedToStorage(value){
  try{
    localStorage.setItem(MUTE_STORAGE_KEY, value ? "1" : "0");
  }catch(e){
    console.error("AudioManager: failed to persist mute state", e);
  }
}

// Preloads every known sound up front (call once at app start) so the first play() of each
// isn't delayed waiting on disk/network. Each sound preloads independently — one missing/corrupt
// file logs a warning but never stops the rest from loading.
function init(){
  Object.keys(SOUNDS).forEach(function(assetId){
    NativeAudio.preload({
      assetId: assetId,
      assetPath: SOUNDS[assetId],
      audioChannelNum: 1,
      isUrl: false
    }).then(function(){
      preloadedIds[assetId] = true;
    }).catch(function(e){
      console.error("AudioManager: failed to preload '" + assetId + "'", e);
    });
  });
  // Reminder-sound previews are full alarm-length tracks, not short UI blips — this is what lets
  // the picker page notice one finished on its own (as opposed to being manually stopped) and
  // flip its play icon back, instead of looking like it's still playing forever. See
  // previewReminderSound/setPreviewingReminderSoundKey below.
  NativeAudio.addListener("complete", function(event){
    if(event.assetId === previewingReminderSoundKey) setPreviewingReminderSoundKey(null);
  });
}

// Every actual play goes through here — swallows any plugin/file error so a missing sound or an
// unsupported platform never breaks the tap/click that triggered it.
function play(assetId){
  if(muted) return;
  if(!preloadedIds[assetId]){
    console.error("AudioManager: '" + assetId + "' isn't preloaded yet, skipping play");
    return;
  }
  NativeAudio.play({ assetId: assetId }).catch(function(e){
    console.error("AudioManager: failed to play '" + assetId + "'", e);
  });
}

// purr loops for as long as the header story image is on screen (see triggerHeaderStoryImage /
// dismissFloatingThoughtEarly in index.html) — started with loop(), cut off with stop() rather
// than left to play out on its own, since it's a sustained sound tied to the picture, not a
// one-shot tap sound.
function loop(assetId){
  if(muted) return;
  if(!preloadedIds[assetId]){
    console.error("AudioManager: '" + assetId + "' isn't preloaded yet, skipping loop");
    return;
  }
  NativeAudio.loop({ assetId: assetId }).catch(function(e){
    console.error("AudioManager: failed to loop '" + assetId + "'", e);
  });
}

function stop(assetId){
  if(!preloadedIds[assetId]) return;
  NativeAudio.stop({ assetId: assetId }).catch(function(e){
    console.error("AudioManager: failed to stop '" + assetId + "'", e);
  });
}

var previewingReminderSoundKey = null; // which picker row (if any) is currently auditioning
var onReminderSoundPreviewChangeFn = null; // index.html's callback — re-renders the picker's play/stop icons

function setPreviewingReminderSoundKey(key){
  previewingReminderSoundKey = key;
  if(onReminderSoundPreviewChangeFn) onReminderSoundPreviewChangeFn(key);
}

// Auditions (or, tapped again, stops auditioning) a reminder-sound picker option by key — every
// reminder-sound key matches its SOUNDS assetId 1:1 (see SOUNDS above), so key IS the assetId
// here. Independent of state.settings.taskReminderSound, since the picker needs to preview
// whichever row is tapped, not just the currently-selected one. These are full alarm-length
// tracks, not short UI blips, so at most one ever plays at a time (tapping a different row while
// one's already going stops it first) and it's always reachable to stop — see
// stopReminderSoundPreview, called when the picker page itself is left.
function previewReminderSound(key){
  if(previewingReminderSoundKey === key){
    stop(key);
    setPreviewingReminderSoundKey(null);
    return;
  }
  if(previewingReminderSoundKey) stop(previewingReminderSoundKey);
  play(key);
  setPreviewingReminderSoundKey(key);
}

function stopReminderSoundPreview(){
  if(!previewingReminderSoundKey) return;
  stop(previewingReminderSoundKey);
  setPreviewingReminderSoundKey(null);
}

function isMuted(){
  return muted;
}

function setMuted(value){
  muted = !!value;
  writeMutedToStorage(muted);
}

function toggleMuted(){
  setMuted(!muted);
  return muted;
}

window.AudioManager = {
  init: init,
  playClick: function(){ play("click"); },
  playCardOpen: function(){ play("card_open"); },
  playDelete: function(){ play("delete"); },
  playGiveABox: function(){ play("give_a_box"); },
  startPurrLoop: function(){ loop("purr"); },
  stopPurrLoop: function(){ stop("purr"); },
  previewReminderSound: previewReminderSound,
  stopReminderSoundPreview: stopReminderSoundPreview,
  getPreviewingReminderSoundKey: function(){ return previewingReminderSoundKey; },
  onReminderSoundPreviewChange: function(fn){ onReminderSoundPreviewChangeFn = fn; },
  isMuted: isMuted,
  setMuted: setMuted,
  toggleMuted: toggleMuted
};
