/* Mech Reminders — saved display preferences (currently: which subjects the list is filtered to).
 *
 * Where it lives: this browser's localStorage. Nothing is sent to Firebase and nothing identifies the person beyond an
 * opaque key, so there is no tracking, no IP address and no server-side rule to maintain. It cannot grant any access:
 * the value is only a list of subject names the page uses to filter what it already shows.
 *
 * Whose it is:
 *   - signed in  → keyed by the stable Firebase user id (uid). Two accounts in the same browser never overwrite each other.
 *   - signed out → one shared "visitor" entry for that browser.
 * Signing out never deletes anything; the next sign-in (or visit) simply loads the entry that belongs to that person.
 * "No saved entry" and "All subjects" are the same thing, so choosing All removes the entry instead of storing a marker.
 *
 * Pure functions + an injectable storage object, so it is unit-tested without a browser (local-tests/reminders-core.test.mjs).
 * To add another preference later, add a sibling pair of load/save functions with its own versioned key prefix. */

const PREFIX = 'mechReminders.subjects.v1';
const MAX_KEYS = 200;          // far above any real number of subjects; just stops junk from growing without bound
const MAX_KEY_LEN = 120;       // same limit as a subject name (LIMITS.subject in core.js)
const MAX_UID_LEN = 128;

const clean = (s) => String(s == null ? '' : s).trim().toLowerCase();

/** Storage key for one person. A missing / odd uid falls back to the shared visitor entry instead of inventing an id. */
export function storageKey(uid) {
  const id = typeof uid === 'string' ? uid.trim() : '';
  return id && id.length <= MAX_UID_LEN ? `${PREFIX}.uid.${id}` : `${PREFIX}.visitor`;
}

/** Stored text → array of unique, lower-case subject keys. Anything unreadable or the wrong shape → [] (= All subjects). */
export function parseSubjects(raw) {
  try {
    const v = JSON.parse(raw);
    const list = v && v.v === 1 && Array.isArray(v.subjects) ? v.subjects : [];
    const out = [];
    for (const item of list) {
      const k = typeof item === 'string' ? clean(item) : '';
      if (k && k.length <= MAX_KEY_LEN && !out.includes(k)) out.push(k);
      if (out.length >= MAX_KEYS) break;
    }
    return out;
  } catch (_) { return []; }
}

const defaultStorage = () => { try { return window.localStorage; } catch (_) { return null; } };   // access itself can throw (blocked cookies)

/** Saved selection for this person ([] = All subjects, also when nothing was ever saved or storage is unavailable). */
export function loadSubjects(uid, storage = defaultStorage()) {
  try { return storage ? parseSubjects(storage.getItem(storageKey(uid))) : []; } catch (_) { return []; }
}

/** Saves the selection ([] removes the entry). Returns false when the browser refused (private mode, quota); the page still works. */
export function saveSubjects(uid, keys, storage = defaultStorage()) {
  if (!storage) return false;
  const list = [...new Set((keys || []).map(clean).filter((k) => k && k.length <= MAX_KEY_LEN))].slice(0, MAX_KEYS);
  try {
    if (list.length) storage.setItem(storageKey(uid), JSON.stringify({ v: 1, subjects: list }));
    else storage.removeItem(storageKey(uid));
    return true;
  } catch (_) { return false; }
}

/* ================================ Personal tasks (localStorage fallback for unauthenticated users) ================================ */

const TASKS_KEY = 'mechReminders.tasks.v1';
const MAX_TASKS = 200;
const MAX_TASK_TITLE = 200;

/** Generate a short random ID for local tasks. */
function localId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Load all local tasks. Returns []. */
export function loadLocalTasks(storage = defaultStorage()) {
  try {
    const raw = storage ? storage.getItem(TASKS_KEY) : null;
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (!v || v.v !== 1 || !Array.isArray(v.tasks)) return [];
    return v.tasks.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string').slice(0, MAX_TASKS);
  } catch (_) { return []; }
}

/** Save all local tasks. */
export function saveLocalTasks(tasks, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    const safe = (tasks || []).slice(0, MAX_TASKS).map((t) => ({
      id: t.id || localId(), title: String(t.title || '').slice(0, MAX_TASK_TITLE),
      subject: String(t.subject || ''), datetime: t.datetime || null,
      notes: String(t.notes || '').slice(0, 1000), completed: t.completed === true,
      reminderLeads: Array.isArray(t.reminderLeads) ? t.reminderLeads : [],
      createdAt: t.createdAt || Date.now()
    }));
    storage.setItem(TASKS_KEY, JSON.stringify({ v: 1, tasks: safe }));
    return true;
  } catch (_) { return false; }
}

/** Create a new local task. Returns the new task with id. */
export function createLocalTask(task, storage = defaultStorage()) {
  const tasks = loadLocalTasks(storage);
  const newTask = {
    id: localId(), title: String(task.title || '').slice(0, MAX_TASK_TITLE),
    subject: String(task.subject || ''), datetime: task.datetime || null,
    notes: String(task.notes || '').slice(0, 1000), completed: false,
    reminderLeads: Array.isArray(task.reminderLeads) ? task.reminderLeads : [],
    createdAt: Date.now()
  };
  tasks.push(newTask);
  saveLocalTasks(tasks, storage);
  return newTask;
}

/** Update a local task by id. */
export function updateLocalTask(taskId, data, storage = defaultStorage()) {
  const tasks = loadLocalTasks(storage);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) return false;
  Object.assign(tasks[idx], data);
  saveLocalTasks(tasks, storage);
  return true;
}

/** Delete a local task by id. */
export function deleteLocalTask(taskId, storage = defaultStorage()) {
  const tasks = loadLocalTasks(storage).filter((t) => t.id !== taskId);
  saveLocalTasks(tasks, storage);
  return true;
}

/* ================================ Notification history (in-app notification center) ================================ */

const NOTIF_HISTORY_KEY = 'mechReminders.notifHistory.v1';
const MAX_NOTIF_HISTORY = 50;

/** Load notification history. */
export function loadNotifHistory(storage = defaultStorage()) {
  try {
    const raw = storage ? storage.getItem(NOTIF_HISTORY_KEY) : null;
    if (!raw) return [];
    const v = JSON.parse(raw);
    return (Array.isArray(v) ? v : []).slice(0, MAX_NOTIF_HISTORY);
  } catch (_) { return []; }
}

/** Add a notification to history. */
export function addNotifHistory(entry, storage = defaultStorage()) {
  if (!storage) return;
  const list = loadNotifHistory(storage);
  list.unshift({ ...entry, timestamp: Date.now(), read: false });
  try { storage.setItem(NOTIF_HISTORY_KEY, JSON.stringify(list.slice(0, MAX_NOTIF_HISTORY))); } catch (_) { /* ignore */ }
}

/** Mark a notification as read. */
export function markNotifRead(index, storage = defaultStorage()) {
  if (!storage) return;
  const list = loadNotifHistory(storage);
  if (list[index]) list[index].read = true;
  try { storage.setItem(NOTIF_HISTORY_KEY, JSON.stringify(list)); } catch (_) { /* ignore */ }
}

/** Mark all notifications as read. */
export function markAllNotifsRead(storage = defaultStorage()) {
  if (!storage) return;
  const list = loadNotifHistory(storage);
  list.forEach((n) => { n.read = true; });
  try { storage.setItem(NOTIF_HISTORY_KEY, JSON.stringify(list)); } catch (_) { /* ignore */ }
}

/** Count unread notifications. */
export function unreadCount(storage = defaultStorage()) {
  return loadNotifHistory(storage).filter((n) => !n.read).length;
}
