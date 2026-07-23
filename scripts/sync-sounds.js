// Fans raw sound files out from www/sounds/ (wherever it's convenient to drop them) to the
// places playback actually needs them:
//   - www/assets/sounds/ — read by the web/browser fallback (NativeAudioWeb.FILE_LOCATION), and
//     what src/audioManager.js's SOUNDS map paths ("assets/sounds/<file>") resolve against there.
//   - android/app/src/main/assets/assets/sounds/ — read by the native Android player, which goes
//     straight through AssetManager at that exact path; `cap sync` never touches this folder
//     (it only copies www/ into .../assets/public/...), so this step can't be skipped.
//   - android/app/src/main/res/raw/ — the curated task-reminder notification sounds only (see
//     TASK_REMINDER_SOUNDS in src/notifications.js), renamed to their res/raw resource name.
//     Android notification channels can only reference a raw resource, never an asset file, so
//     these need their own copy under their own (lowercase, underscore) names.
// Run via `npm run sync` (folded in automatically) whenever sound files change, then rebuild the
// APK — like icons, sounds are native content and are NOT delivered by the OTA updater.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "www", "sounds");
// Curated "alarm-style" reminder sound options (see the reminder sound picker in Settings —
// index.html) live in their own subfolder just to keep them apart from the UI-effect sounds
// (clicks, purrs, etc.) directly in www/sounds/ — everything below still flattens into the same
// destination namespaces, so the subfolder is source-side organization only.
const ALARM_SRC_DIR = path.join(SRC_DIR, "alarm");
const WEB_DEST_DIR = path.join(ROOT, "www", "assets", "sounds");
const ANDROID_DEST_DIR = path.join(ROOT, "android", "app", "src", "main", "assets", "assets", "sounds");
const ANDROID_RAW_DEST_DIR = path.join(ROOT, "android", "app", "src", "main", "res", "raw");

// Keep in sync with TASK_REMINDER_SOUNDS in src/notifications.js. Values are paths relative to
// SRC_DIR (www/sounds/) — an "alarm/" prefix just means the source file lives in that subfolder.
const REMINDER_RAW_SOUNDS = {
  "reminder_fairy_tail_happy.mp3": "alarm/fairy_tail_happy.mp3",
  "reminder_last_magic.mp3": "alarm/last_magic.mp3",
  "reminder_magic.mp3": "alarm/magic.mp3",
  "reminder_magical_classic.mp3": "alarm/magical_classic.mp3",
  "reminder_thank_you.mp3": "alarm/thank_you.mp3",
  "reminder_the_magic_knights.mp3": "alarm/the_magic_knights.mp3",
  "reminder_violin.mp3": "alarm/violin.mp3",
  "reminder_violin_music.mp3": "alarm/violin_music.mp3"
};

// f may carry a source-side subfolder prefix (e.g. "alarm/violin.mp3") — destination is always
// flat, keyed by basename only, since that's the single namespace both audioManager.js's SOUNDS
// map and the Android AssetManager path expect.
function copyAllInto(files, destDir){
  fs.mkdirSync(destDir, { recursive: true });
  files.forEach((f) => fs.copyFileSync(path.join(SRC_DIR, f), path.join(destDir, path.basename(f))));
}

function syncReminderRawSounds(){
  fs.mkdirSync(ANDROID_RAW_DEST_DIR, { recursive: true });
  Object.entries(REMINDER_RAW_SOUNDS).forEach(([rawName, srcName]) => {
    fs.copyFileSync(path.join(SRC_DIR, srcName), path.join(ANDROID_RAW_DEST_DIR, rawName));
  });
  console.log(`sync-sounds: synced ${Object.keys(REMINDER_RAW_SOUNDS).length} reminder sound(s) to res/raw`);
}

function main(){
  if(!fs.existsSync(SRC_DIR)){
    console.log("sync-sounds: no www/sounds/ folder yet — nothing to sync");
    return;
  }
  const topFiles = fs.readdirSync(SRC_DIR).filter((f) => fs.statSync(path.join(SRC_DIR, f)).isFile());
  const alarmFiles = fs.existsSync(ALARM_SRC_DIR)
    ? fs.readdirSync(ALARM_SRC_DIR).filter((f) => fs.statSync(path.join(ALARM_SRC_DIR, f)).isFile()).map((f) => "alarm/" + f)
    : [];
  const files = topFiles.concat(alarmFiles);
  if(files.length === 0){
    console.log("sync-sounds: www/sounds/ is empty — nothing to sync");
    return;
  }
  copyAllInto(files, WEB_DEST_DIR);
  copyAllInto(files, ANDROID_DEST_DIR);
  console.log(`sync-sounds: synced ${files.length} file(s) — ${files.join(", ")}`);
  syncReminderRawSounds();
}

main();
