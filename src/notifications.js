// Real OS-level scheduled notifications via the official @capacitor/local-notifications plugin
// — bundled with esbuild (see package.json's "build:notifications" script) into
// www/notifications.bundle.js, the same convention the other native-plugin modules use. Talks
// to the rest of the (non-module, unbundled) app only through window.AppNotifications.
//
// Why this exists: task reminders used to fire via the browser's `Notification` API, and the
// Pomodoro chime via a plain `new Audio()` call — both only ever run while the app's own JS is
// actively executing (foregrounded, not Doze-throttled), so neither ever reached the user once
// the app was backgrounded or the screen was off, which is exactly when a reminder needs to
// fire. Scheduling through the OS here means the alert survives the app being closed entirely.
import { LocalNotifications } from "@capacitor/local-notifications";

// A stable 32-bit-safe int from an arbitrary string id, since LocalNotificationSchema.id must be
// a plain 32-bit int but task/subtask ids (see genId() in index.html) are strings. djb2, folded
// into a positive range comfortably inside Android's int32 bound.
function hashId(str){
  var h = 5381;
  for(var i = 0; i < str.length; i++){
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 2000000000;
}

// Reserved outside the hashId() range above (which tops out under 2e9) so these can never
// collide with a task/subtask reminder's id. Two ids, one per Pomodoro phase — NOT one shared
// id (what this used to be). The reason: advanceFocusPhase() in index.html schedules the next
// phase's notification the instant the local JS countdown reaches zero — i.e. at essentially the
// same moment the OS alarm for the phase that just ended is due to fire. With one shared id,
// that reschedule call replaces whatever's pending under that id (Android's PendingIntent
// FLAG_CANCEL_CURRENT semantics — scheduling over an id cancels any not-yet-fired alarm using
// it), which reliably cancelled the just-due notification before it could ever display, every
// single time the app was open to see the transition happen. Two ids means advancing to the next
// phase never touches the id the current (about-to-fire) phase is using.
var POMODORO_NOTIFICATION_IDS = { work: 2000000001, "break": 2000000002 };

// Curated task/subtask reminder sounds (see the reminder sound picker in Settings — index.html)
// — each needs its own Android notification channel, since a channel's sound is immutable once
// created (Android 8+). Habit/pantry reminders never pass a channelId at all, so they're entirely
// unaffected by this — this is task-reminders-only, per spec. Every entry here is a curated pick
// a user dropped into www/sounds/alarm/ (the old "default"/system-sound and "box"/"card" options
// were dropped — she doesn't use them) — keep this in sync with REMINDER_RAW_SOUNDS in
// scripts/sync-sounds.js (source files) and SOUNDS in src/audioManager.js (in-app preview
// playback).
var TASK_REMINDER_SOUNDS = {
  fairy_tail_happy:   { channelId: "task_reminder_fairy_tail_happy",   file: "reminder_fairy_tail_happy.mp3"   },
  last_magic:         { channelId: "task_reminder_last_magic",         file: "reminder_last_magic.mp3"         },
  magic:              { channelId: "task_reminder_magic",              file: "reminder_magic.mp3"              },
  magical_classic:    { channelId: "task_reminder_magical_classic",    file: "reminder_magical_classic.mp3"    },
  thank_you:          { channelId: "task_reminder_thank_you",          file: "reminder_thank_you.mp3"          },
  the_magic_knights:  { channelId: "task_reminder_the_magic_knights",  file: "reminder_the_magic_knights.mp3"  },
  violin:             { channelId: "task_reminder_violin",             file: "reminder_violin.mp3"             },
  violin_music:       { channelId: "task_reminder_violin_music",       file: "reminder_violin_music.mp3"       }
};

// Leftover from a reverted "keeps ringing" approximation (extra re-fires a minute apart) that
// turned out to break task reminders arriving at all — kept only so cancelReminder below can
// still clean up any of those extra fires a device might already have scheduled from that build.
var TASK_REMINDER_ALARM_REPEATS = 5;

var TASK_ACTION_TYPE_ID = "TASK_REMINDER";
var onTaskActionFn = null;

function init(){
  LocalNotifications.requestPermissions().then(function(result){
    // display is the one that actually gates whether a scheduled notification can ever show —
    // "denied" here means every schedule() call below will silently succeed (no error) while the
    // OS drops the notification at delivery time, which looks from JS exactly like nothing being
    // wrong. Logged so it's visible via chrome://inspect instead of just guessing.
    console.log("AppNotifications: permission status", result && result.display);
  }).catch(function(e){
    console.error("AppNotifications: requestPermissions failed", e);
  });

  Object.keys(TASK_REMINDER_SOUNDS).forEach(function(key){
    var sound = TASK_REMINDER_SOUNDS[key];
    if(!sound) return;
    // createChannel is a no-op if this exact channel (id+settings) already exists, so calling it
    // on every launch is safe — it only actually matters the first time.
    LocalNotifications.createChannel({
      id: sound.channelId, name: "Mr. Lapkins — task reminder (" + key + ")",
      sound: sound.file, importance: 4, vibration: true
    }).catch(function(e){ console.error("AppNotifications: createChannel failed", sound.channelId, e); });
  });

  // Bridges the Snooze/Done buttons (see registerTaskActions) back to index.html — extra.key is
  // the same "task:<id>"/"subtask:<id>" string the reminder was scheduled under, since the
  // notification's own `id` is just hashId(key), not reversible back to the original string id.
  LocalNotifications.addListener("localNotificationActionPerformed", function(action){
    var extra = action.notification && action.notification.extra;
    if(extra && extra.key && onTaskActionFn) onTaskActionFn(action.actionId, extra.key);
  });
}

function scheduleAt(id, title, body, when, opts){
  if(!(when instanceof Date) || isNaN(when.getTime())){
    console.warn("AppNotifications: scheduleAt got an invalid date, skipping", id, when);
    return;
  }
  opts = opts || {};
  var notification = { id: id, title: title, body: body, schedule: { at: when, allowWhileIdle: true } };
  if(opts.channelId) notification.channelId = opts.channelId;
  if(opts.actionTypeId) notification.actionTypeId = opts.actionTypeId;
  if(opts.extra) notification.extra = opts.extra;
  if(opts.ongoing) notification.ongoing = true;
  if(opts.autoCancel === false) notification.autoCancel = false;
  LocalNotifications.schedule({
    notifications: [notification]
  }).then(function(){
    console.log("AppNotifications: scheduled", id, "for", when.toISOString());
  }).catch(function(e){
    console.error("AppNotifications: schedule failed", id, e);
  });
}

function cancel(id){
  LocalNotifications.cancel({ notifications: [{ id: id }] }).catch(function(e){
    console.error("AppNotifications: cancel failed", e);
  });
}

window.AppNotifications = {
  init: init,
  // Reminders — id is the task's or subtask's own string id from state; callers build their own
  // namespaced key (see index.html) so a subtask can never collide with its parent task's id.
  // opts (task/subtask reminders only — see taskReminderChannelId/taskActionTypeId below) is
  // { channelId, actionTypeId, extra }, all optional; habit/pantry callers never pass it.
  scheduleReminder: function(key, title, body, when, opts){ scheduleAt(hashId(key), title, body, when, opts); },
  // Also clears ids hashId(key)+1..+TASK_REMINDER_ALARM_REPEATS — not used by anything anymore
  // (see the removed scheduleTaskReminderRepeats/the "keeps ringing" alarm approximation, reverted
  // after it broke task reminders arriving at all — see taskReminderOpts in index.html), but a
  // build that shipped with it briefly could still have some of those extra fires sitting
  // scheduled on a device; cancelling a never-scheduled id is a harmless no-op, so this stays as
  // passive cleanup for that until it can't matter anymore.
  cancelReminder: function(key){
    var baseId = hashId(key);
    cancel(baseId);
    for(var i = 1; i <= TASK_REMINDER_ALARM_REPEATS; i++) cancel(baseId + i);
  },
  // Pomodoro — phase is "work" or "break", picks which of the two ids above to use (see the
  // comment there for why there are two). cancelPomodoroEnd cancels both, since pausing/leaving
  // focus mode should clear whatever's pending regardless of which phase it was for.
  schedulePomodoroEnd: function(phase, title, body, when){
    scheduleAt(POMODORO_NOTIFICATION_IDS[phase] || POMODORO_NOTIFICATION_IDS.work, title, body, when);
  },
  cancelPomodoroEnd: function(){
    cancel(POMODORO_NOTIFICATION_IDS.work);
    cancel(POMODORO_NOTIFICATION_IDS["break"]);
  },
  // The valid values for the "Звук напоминания" setting (state.settings.taskReminderSound) —
  // exported so index.html's Settings picker and normalizeState don't hardcode their own copy.
  taskReminderSoundKeys: Object.keys(TASK_REMINDER_SOUNDS),
  taskReminderChannelId: function(key){
    var sound = TASK_REMINDER_SOUNDS[key];
    return sound ? sound.channelId : undefined;
  },
  taskActionTypeId: TASK_ACTION_TYPE_ID,
  // Registers (or re-registers) the Snooze/Done action buttons shown on task/subtask reminders.
  // Titles are plain strings baked in at registration time, not re-translated live, so index.html
  // calls this once at startup and again whenever the app language changes.
  registerTaskActions: function(snoozeTitle, doneTitle){
    LocalNotifications.registerActionTypes({
      types: [{
        id: TASK_ACTION_TYPE_ID,
        actions: [
          { id: "snooze", title: snoozeTitle },
          { id: "done", title: doneTitle }
        ]
      }]
    }).catch(function(e){ console.error("AppNotifications: registerActionTypes failed", e); });
  },
  // fn(actionId, key) — key is the same "task:<id>"/"subtask:<id>" string scheduleReminder was
  // called with.
  onTaskAction: function(fn){ onTaskActionFn = fn; }
};
