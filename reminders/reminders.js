/* Mech Reminders — UI.
 * Public visitors read PUBLISHED records. Administrators get the dashboard. Who is an administrator is NOT written
 * in this file: the owner (one fixed account) manages a list stored in Firestore (collection "admins"), and this page
 * simply listens to its own entry in that list. Everything here only decides what the page SHOWS; the real gate is
 * firestore.rules on the server, which re-checks the list on every request. */
import * as core from './core.js';
import { FIREBASE_CONFIG, isConfigured } from './firebase-config.js';
import { createBackend } from './backend.js';
import * as prefs from './preferences.js';

const TICK_MS = 30 * 1000;
const LS_SETTINGS = 'mechReminders.settings.v1';   // per-device notification preferences (not shared data)
const LS_FIRED = 'mechReminders.fired.v1';

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);   // strings become text nodes (never HTML)
  return el;
};
const svg = (paths) => { const t = document.createElement('template'); t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`; return t.content.firstChild; };
const PDF_ICON = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>';
const CLOCK_ICON = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
const CHECK_ICON = '<polyline points="20 6 9 17 4 12"/>';

const state = {
  backend: null, user: null, isAdmin: false, isOwner: false, isManager: false,   // manager = admin allowed to manage administrators
  adminChecked: false, wasRevoked: false, authGen: 0, unsubSelf: null,         // own access entry (admins/{my e-mail})
  admins: [], adminsLoaded: false, adminsError: false, unsubAdmins: null,       // the whole list (owner only)
  ownerAction: null,
  records: [], loaded: false, unsub: null,
  filters: { subjects: [], type: 'all', status: 'all', sort: 'smart', search: '' },
  adminFilters: { subject: 'all', type: 'all', status: 'all', sort: 'smart', search: '' },
  prefUid: undefined, subjectSig: '',                                           // whose saved subject choice is loaded · options currently drawn
  now: Date.now(), sig: '',
  editingId: null, publishId: null, deleteId: null, busy: false,
  settings: loadSettings(),
  // Personal tasks
  tasks: [], tasksLoaded: false, unsubTasks: null, editingTaskId: null, deleteTaskId: null,
  taskSource: 'local'   // 'local' | 'cloud'
};
const published = () => state.records.filter((r) => r.published);

/* ================= status / messages ================= */
function showStatus(kind, title, text) {
  const box = $('status');
  box.replaceChildren();
  if (!title && !text) return;
  box.append(h('div', { class: `notice ${kind}`, role: kind === 'error' ? 'alert' : null }, h('div', {}, title ? h('strong', {}, title) : null, text || '')));
}
function explain(e) {
  const c = String((e && (e.code || e.message)) || '');
  if (/permission-denied/.test(c)) return 'Not allowed. Only authorized administrator accounts can change Mech Reminders (your access may have been revoked).';
  if (/unauthenticated/.test(c)) return 'You were signed out. Sign in again.';
  if (/unavailable|network/.test(c)) return 'Network problem. Check your connection and try again.';
  if (/popup-closed|cancelled-popup/.test(c)) return '';
  if (/popup-blocked/.test(c)) return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  if (/unauthorized-domain/.test(c)) return 'This website address is not authorized for sign-in yet. Add it under Firebase → Authentication → Settings → Authorized domains.';
  return 'Something went wrong. Please try again.';
}

/* ================= data watching ================= */
function startWatching() {
  if (state.unsub) { state.unsub(); state.unsub = null; }
  state.records = []; state.loaded = false;
  const ok = (rows) => { state.records = rows; state.loaded = true; showStatus(); renderAll(); checkReminders(); };
  const err = (e) => {
    if (state.isAdmin && !state.isOwner && /permission-denied/.test(String((e && e.code) || ''))) {
      // The server refused the admin query: this account is no longer an administrator, whatever the page last believed.
      state.isAdmin = false; state.isManager = false; stopAdminListWatcher(); state.wasRevoked = true; state.adminChecked = true;
      renderAccount(); startWatching();
      return;
    }
    state.loaded = true; state.records = [];
    showStatus('error', state.isAdmin ? 'Could not load the records.' : 'Could not load deadlines.', explain(e) || 'Try again in a moment.');
    renderAll();
  };
  try { state.unsub = (state.isAdmin ? state.backend.watchAll : state.backend.watchPublished)(ok, err); } catch (e) { err(e); }
  renderAll();
}

/* ================= who is an administrator ================= */
const canManage = () => state.isOwner || state.isManager;           // may see / use Admin Management (server re-checks every write)

function stopAdminListWatcher() {
  if (state.unsubAdmins) { state.unsubAdmins(); state.unsubAdmins = null; }
  state.admins = []; state.adminsLoaded = false; state.adminsError = false;
}
function stopAccessWatchers() {
  if (state.unsubSelf) { state.unsubSelf(); state.unsubSelf = null; }
  stopAdminListWatcher();
}

function onAuth(user) {
  const gen = ++state.authGen;                       // callbacks from an earlier sign-in must never change this one
  stopAccessWatchers();
  state.user = user;
  loadSubjectPrefs(user && user.uid);
  const verified = !!user && user.verified;
  state.isOwner = verified && core.normalizeEmail(user.email) === core.normalizeEmail(core.OWNER_EMAIL);
  state.isManager = false;
  state.isAdmin = state.isOwner;                     // everyone else is NOT an admin until the server-side list says so
  state.adminChecked = !verified || state.isOwner;
  state.wasRevoked = false;
  renderAccount();
  startWatching();
  if (!verified) return;
  if (state.isOwner) watchOwnerList(gen); else watchOwnAccess(gen);
}

/** Listens to admins/{my e-mail}. The owner changing that document (grant / revoke / remove) reaches an open page within
 *  moments: the page drops its dashboard and falls back to the published-only view. Writes were already refused by the server. */
function watchOwnAccess(gen) {
  const apply = (active, manager) => {
    if (gen !== state.authGen) return;
    const was = state.isAdmin, wasMgr = state.isManager, first = !state.adminChecked;
    state.adminChecked = true; state.isAdmin = active; state.isManager = active && manager;
    if (was && !active) state.wasRevoked = true;
    if (active) state.wasRevoked = false;
    if (state.isManager && !wasMgr) watchOwnerList(gen);            // managers need the list to manage it
    if (!state.isManager && wasMgr) stopAdminListWatcher();
    if (first || was !== active || wasMgr !== state.isManager) renderAccount();
    if (was !== active) startWatching();            // swap between the published-only and the full (admin) query
    else if (wasMgr !== state.isManager) renderOwner();
  };
  try {
    state.unsubSelf = state.backend.watchSelfAdmin(state.user.email,
      (entry) => apply(!!entry && entry.active === true, !!entry && entry.canManage === true),
      (e) => { if (/permission-denied/.test(String((e && e.code) || ''))) apply(false, false); });   // other errors (network): keep what we know
  } catch (_) { apply(false, false); }
}

function watchOwnerList(gen) {
  if (state.unsubAdmins) return;
  const stale = () => gen !== state.authGen;
  try {
    state.unsubAdmins = state.backend.watchAdmins(
      (rows) => { if (stale()) return; state.admins = rows; state.adminsLoaded = true; state.adminsError = false; renderOwner(); },
      (e) => { if (stale()) return; state.admins = []; state.adminsLoaded = true; state.adminsError = true; renderOwner(); ownerMsg('error', 'Could not load the administrator list.', explainOwner(e)); });
  } catch (e) { state.adminsLoaded = true; state.adminsError = true; renderOwner(); ownerMsg('error', 'Could not load the administrator list.', explainOwner(e)); }
}

/* ================= rendering ================= */
function renderAll() { renderStats(); renderFilters(); renderList(); renderAdmin(); renderOwner(); state.sig = signature(); }

function signature() {
  return state.records.map((r) => { const t = core.timeInfo(r, state.now); return `${r.id}:${t.status}:${t.urgency}:${r.published}`; }).join('|');
}

function renderAccount() {
  const box = $('account');
  box.replaceChildren();
  box.hidden = false;
  if (!state.user) {
    box.append(h('span', {}, 'Class administrator?'), h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: signIn }, 'Administrator sign-in'));
    $('admin').hidden = true;
    return;
  }
  const role = state.isOwner ? ' — Owner'
    : state.isManager ? ' — Administrator (can manage administrators)'
    : state.isAdmin ? ' — Administrator'
    : !state.adminChecked ? ''
    : state.wasRevoked ? ' — your administrator access was revoked by the owner.'
    : ' — this account is not authorized to manage Mech Reminders.';
  box.append(
    h('span', { class: 'who' }, `Signed in as ${state.user.email}`, role),
    h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: signOut }, 'Sign out'));
}

function renderStats() {
  const c = { upcoming: 0, overdue: 0, past: 0 };
  published().forEach((r) => { c[core.statusOf(r, state.now)]++; });
  const ready = state.loaded;
  $('stat-upcoming').textContent = ready ? c.upcoming : '–';
  $('stat-overdue').textContent = ready ? c.overdue : '–';
  $('stat-past').textContent = ready ? c.past : '–';
}

function fillSelect(sel, options, current) {
  sel.replaceChildren(...options.map(([v, label]) => h('option', { value: v }, label)));
  sel.value = options.some(([v]) => v === current) ? current : options[0][0];
}
function renderFilters() {
  renderSubjectPicker();
  fillSelect($('flt-type'), [['all', 'All types'], ...core.TYPES.map((t) => [t, t])], state.filters.type);
  state.filters.type = $('flt-type').value;
  $('flt-status').value = state.filters.status;
  $('flt-sort').value = state.filters.sort;
}

/* ---- subject picker (multi-select) ----
 * Options come from the published records themselves. state.filters.subjects holds the chosen keys; [] means "All subjects".
 * Every change is saved for this person right away (see preferences.js). */
const subjectKeys = () => core.subjectOptions(published()).map((o) => o.key);
const activeSubjects = () => core.resolveSubjects(state.filters.subjects, subjectKeys());   // what the list really filters by
const activeFilters = () => ({ ...state.filters, subjects: activeSubjects() });

function loadSubjectPrefs(uid) {
  const id = uid || null;
  if (state.prefUid === id) return;                  // same person as before: keep the in-memory choice (storage may be unavailable)
  state.prefUid = id;
  state.filters.subjects = prefs.loadSubjects(id);   // never saved → [] → All subjects
}

function setSubjects(next) {
  state.filters.subjects = next;
  prefs.saveSubjects(state.prefUid, next);
  renderSubjectPicker();
  renderList();
}

function renderSubjectPicker() {
  const options = core.subjectOptions(published());
  const sig = options.map((o) => o.key).join('\u0001');
  const list = $('flt-subject-list');
  if (sig !== state.subjectSig) {                    // rebuild only when the set of subjects changed, so an open panel is not disturbed
    state.subjectSig = sig;
    list.replaceChildren(...options.map((o) => h('label', { class: 'ms-opt' }, h('input', { type: 'checkbox', value: o.key }), h('span', {}, o.label))));
  }
  const active = new Set(activeSubjects());
  list.querySelectorAll('input').forEach((i) => { i.checked = active.has(i.value); });
  $('flt-subject-all').checked = active.size === 0;
  $('flt-subject-reset').disabled = active.size === 0 && state.filters.subjects.length === 0;
  const names = options.filter((o) => active.has(o.key)).map((o) => o.label);
  $('flt-subject-text').textContent = !names.length ? 'All subjects' : names.length === 1 ? names[0] : `${names.length} subjects`;
  $('flt-subject-empty').hidden = options.length > 0;
}

function wireSubjectPicker() {
  const box = $('flt-subject'), btn = $('flt-subject-btn');
  $('flt-subject-list').addEventListener('change', (e) => {
    const input = e.target.closest('input[type=checkbox]');
    if (input) setSubjects(core.toggleSubject(state.filters.subjects, input.value, subjectKeys()));
  });
  $('flt-subject-all').addEventListener('change', () => setSubjects([]));      // "All subjects" is never left unticked with nothing else chosen
  $('flt-subject-reset').addEventListener('click', () => setSubjects([]));
  document.addEventListener('click', (e) => { if (box.open && !box.contains(e.target)) box.open = false; });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.open) { box.open = false; btn.focus(); } });
  box.addEventListener('focusout', (e) => { if (box.open && e.relatedTarget && !box.contains(e.relatedTarget)) box.open = false; });
}

const GROUPS = [
  ['upcoming', 'Upcoming', 'Before the official deadline'],
  ['overdue', 'Deadline passed, still open', 'The submission window has not closed yet'],
  ['past', 'Closed', 'The closing time has passed']
];

function renderList() {
  const list = $('list'), empty = $('empty');
  list.replaceChildren();
  empty.hidden = true;
  if (!state.loaded) { list.append(h('p', { class: 'empty', role: 'status' }, 'Loading deadlines…')); return; }
  const items = core.filterAndSort(published(), activeFilters(), state.now);
  if (!items.length) {
    empty.textContent = published().length ? 'No submissions match these filters.' : 'No deadlines have been published yet.';
    empty.hidden = false;
    return;
  }
  for (const [key, title, note] of GROUPS) {
    const rows = items.filter((r) => core.statusOf(r, state.now) === key);
    if (!rows.length) continue;
    list.append(h('section', { class: 'group', 'aria-label': title, 'data-group': key },
      h('h2', {}, title, h('small', {}, `${rows.length} · ${note}`)),
      h('ul', { class: 'cards' }, rows.map((r) => h('li', {}, renderCard(r))))));
    list.lastChild.style.marginBottom = '28px';
  }
}

function renderCard(r) {
  const t = core.timeInfo(r, state.now);
  const dateList = r.closesAt != null
    ? h('dl', { class: 'dates' },
        h('dt', {}, 'Deadline'), h('dd', {}, core.formatCairo(r.deadline)),
        h('dt', {}, 'Closes'), h('dd', {}, core.formatCairo(r.closesAt)))
    : h('dl', { class: 'dates dates-single' },
        h('dt', {}, 'Deadline'), h('dd', {}, core.formatCairo(r.deadline)));
  return h('article', { class: 'sub-card', 'data-id': r.id, 'data-status': t.status, 'data-urgency': t.urgency },
    h('div', { class: 'sub-head' },
      h('h3', {}, r.subject),
      h('span', { class: 'badge type' }, r.type)),
    r.courseCode ? h('p', { class: 'sub-code' }, r.courseCode) : null,
    dateList,
    h('p', { class: 'time-pill', 'data-role': 'time' }, svg(CLOCK_ICON), h('span', {}, t.label)),
    r.description ? h('p', { class: 'sub-desc' }, r.description) : null,
    r.attachments.length ? h('ul', { class: 'atts', 'aria-label': 'PDF attachments' }, r.attachments.map(renderAttachment)) : null);
}

function renderAttachment(a) {
  const body = [svg(PDF_ICON), h('span', {}, h('span', {}, a.title || 'PDF'), a.description ? h('small', {}, a.description) : null)];
  if (!core.isHttpsUrl(a.url)) return h('li', {}, h('span', { class: 'hint', style: 'display:flex;gap:10px;align-items:center;min-height:44px;padding:8px 12px' }, `${a.title || 'PDF'} — link unavailable`));
  return h('li', {}, h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open PDF: ${a.title} (opens in a new tab)` }, body));
}

function updateTimeLabels() {
  document.querySelectorAll('#list [data-id]').forEach((card) => {
    const r = state.records.find((x) => x.id === card.dataset.id);
    if (r) card.querySelector('[data-role=time] span').textContent = core.timeInfo(r, state.now).label;
  });
}

/* ================= admin dashboard ================= */
function fillAdminFilters() {
  const subjects = core.subjectsOf(state.records);
  const subjectSel = $('adm-subject');
  const curSubj = subjectSel.value;
  subjectSel.replaceChildren(h('option', { value: 'all' }, 'All subjects'), ...subjects.map((s) => h('option', { value: s }, s)));
  subjectSel.value = subjects.includes(curSubj) ? curSubj : 'all';
  state.adminFilters.subject = subjectSel.value;
  const typeSel = $('adm-type');
  const curType = typeSel.value;
  typeSel.replaceChildren(h('option', { value: 'all' }, 'All types'), ...core.TYPES.map((t) => h('option', { value: t }, t)));
  typeSel.value = core.TYPES.includes(curType) ? curType : 'all';
  state.adminFilters.type = typeSel.value;
  $('adm-status').value = state.adminFilters.status;
  $('adm-sort').value = state.adminFilters.sort;
}
function adminFilteredRecords() {
  const f = state.adminFilters;
  let rows = [...state.records];
  if (f.subject && f.subject !== 'all') rows = rows.filter((r) => r.subject.trim().toLowerCase() === f.subject.trim().toLowerCase());
  if (f.type && f.type !== 'all') rows = rows.filter((r) => r.type === f.type);
  if (f.status === 'published') rows = rows.filter((r) => r.published);
  else if (f.status === 'draft') rows = rows.filter((r) => !r.published);
  else if (f.status && f.status !== 'all') rows = rows.filter((r) => core.statusOf(r, state.now) === f.status);
  if (f.search) rows = rows.filter((r) => core.searchMatches(r, f.search));
  const by = {
    'deadline-asc': (a, b) => a.deadline - b.deadline, 'deadline-desc': (a, b) => b.deadline - a.deadline,
    'newest': (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    'subject': (a, b) => a.subject.localeCompare(b.subject) || a.deadline - b.deadline,
    'smart': (a, b) => { const sa = core.statusOf(a, state.now), sb = core.statusOf(b, state.now), rank = { upcoming: 0, overdue: 1, past: 2 }; if (sa !== sb) return rank[sa] - rank[sb]; return sa === 'past' ? b.deadline - a.deadline : a.deadline - b.deadline; }
  };
  return rows.sort(by[f.sort] || by.smart);
}
function renderAdmin() {
  const panel = $('admin');
  panel.hidden = !state.isAdmin;
  if (!state.isAdmin) { clearAdminDom(); return; }
  fillAdminFilters();
  const ul = $('admin-list');
  ul.replaceChildren();
  if (!state.loaded) { ul.append(h('li', { class: 'hint' }, 'Loading…')); return; }
  const rows = adminFilteredRecords();
  if (!rows.length) { ul.append(h('li', { class: 'hint' }, state.records.length ? 'No records match these filters.' : 'No records yet. Use "New submission" to add the first one.')); return; }
  for (const r of rows) {
    const st = { upcoming: 'Upcoming', overdue: 'Deadline passed, still open', past: 'Closed' }[core.statusOf(r, state.now)];
    const closesText = r.closesAt != null ? ` · Closes ${core.formatCairo(r.closesAt)}` : '';
    ul.append(h('li', { class: 'admin-row', 'data-id': r.id },
      h('div', {},
        h('div', { class: 'title' }, r.subject, r.courseCode ? ` (${r.courseCode})` : '', ' ', h('span', { class: 'badge type' }, r.type), ' ',
          h('span', { class: r.published ? 'badge pub' : 'badge draft' }, r.published ? 'Published' : 'Draft')),
        h('div', { class: 'sub' }, `Deadline ${core.formatCairo(r.deadline)}${closesText} · ${r.attachments.length} PDF link${r.attachments.length === 1 ? '' : 's'} · ${st}`)),
      h('div', { class: 'admin-actions' },
        h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-act': 'edit', onclick: () => openForm(r) }, 'Edit'),
        h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-act': 'preview', onclick: () => openPreview(r, {}) }, 'Preview'),
        r.published
          ? h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-act': 'unpublish', onclick: () => setPublished(r.id, false) }, 'Unpublish')
          : h('button', { type: 'button', class: 'btn btn-sm', 'data-act': 'publish', onclick: () => openPreview(r, { publishId: r.id }) }, 'Publish'),
        h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-act': 'delete', onclick: () => openDelete(r) }, 'Delete'))));
  }
}
/* After sign-out (or for non-admins) nothing from the admin side may linger in the page: drafts, form values, previews. */
function clearAdminDom() {
  ['form-dialog', 'preview-dialog', 'confirm-dialog'].forEach((id) => { const d = $(id); if (d.open) d.close(); });
  $('admin-list').replaceChildren(); $('subject-options').replaceChildren(); $('f-atts').replaceChildren(); $('preview-card').replaceChildren();
  $('form').reset();
  state.editingId = state.publishId = state.deleteId = null;
}

/** Runs one write. errBox: an element (text is set on it), a function (receives the message) or nothing (page notice).
 *  Refuses to start when this page no longer believes the account is an administrator (the server would refuse anyway). */
async function guarded(fn, errBox, explainFn = explain) {
  if (state.busy) return false;
  const report = (msg) => { if (typeof errBox === 'function') errBox(msg); else if (errBox) errBox.textContent = msg; else showStatus('error', 'That did not work.', msg); };
  if (!state.isAdmin) { report('Not allowed. This account is no longer an authorized administrator.'); return false; }
  state.busy = true;
  if (errBox && typeof errBox !== 'function') errBox.textContent = '';
  try { await fn(); return true; }
  catch (e) { report(explainFn(e)); return false; }
  finally { state.busy = false; }
}

async function setPublished(id, value) {
  await guarded(() => state.backend.setPublished(id, value));
}

/* ---- form ---- */
const typeOptions = () => [h('option', { value: '' }, 'Choose…'), ...core.TYPES.map((t) => h('option', { value: t }, t))];

function attRow(a = {}) {
  const row = h('div', { class: 'att-row', 'data-row': '' },
    h('div', { class: 'field' }, h('label', {}, 'PDF title'), h('input', { type: 'text', class: 'a-title', maxlength: 120, value: a.title || '' }), h('p', { class: 'err', 'data-e': 'title' })),
    h('div', { class: 'field' }, h('label', {}, 'PDF link (https://…)'), h('input', { type: 'url', class: 'a-url', inputmode: 'url', value: a.url || '', autocomplete: 'off' }), h('p', { class: 'err', 'data-e': 'url' })),
    h('div', { class: 'field' }, h('label', {}, 'Note (optional)'), h('input', { type: 'text', class: 'a-desc', maxlength: 300, value: a.description || '' }), h('p', { class: 'err', 'data-e': 'description' })),
    h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-act': 'remove-att', onclick: () => row.remove() }, 'Remove link')));
  return row;
}

function openForm(rec) {
  state.editingId = rec ? rec.id : null;
  $('form-title').textContent = rec ? 'Edit submission' : 'New submission';
  $('form-error').textContent = '';
  clearErrors();
  $('subject-options').replaceChildren(...core.subjectsOf(state.records).map((s) => h('option', { value: s })));
  $('f-type').replaceChildren(...typeOptions());
  $('f-subject').value = rec ? rec.subject : '';
  $('f-type').value = rec ? rec.type : '';
  $('f-code').value = rec ? rec.courseCode : '';
  $('f-desc').value = rec ? rec.description : '';
  $('f-deadline').value = rec ? core.toCairoInputValue(rec.deadline) : '';
  $('f-closes').value = rec ? core.toCairoInputValue(rec.closesAt) : '';
  $('f-published').checked = rec ? rec.published : false;
  $('f-atts').replaceChildren(...(rec && rec.attachments.length ? rec.attachments : [{}]).map(attRow));
  $('form-dialog').showModal();
  $('f-subject').focus();
}

function readForm() {
  return {
    subject: $('f-subject').value, type: $('f-type').value, courseCode: $('f-code').value, description: $('f-desc').value,
    deadline: $('f-deadline').value, closesAt: $('f-closes').value, published: $('f-published').checked,
    attachments: [...document.querySelectorAll('#f-atts .att-row')].map((r) => ({
      title: r.querySelector('.a-title').value, url: r.querySelector('.a-url').value, description: r.querySelector('.a-desc').value
    }))
  };
}

function clearErrors() { document.querySelectorAll('#form .err').forEach((p) => { p.textContent = ''; }); }
function showErrors(errors) {
  clearErrors();
  let first = null;
  for (const [k, msg] of Object.entries(errors)) {
    let el = $('e-' + k), field = null;
    const m = /^attachments\.(\d+)\.(\w+)$/.exec(k);
    if (m) { const row = document.querySelectorAll('#f-atts .att-row')[+m[1]]; el = row && row.querySelector(`[data-e=${m[2]}]`); }
    if (el) { el.textContent = msg; field = el.previousElementSibling; }
    if (!first && field) first = field;
  }
  if (first && first.focus) first.focus();
}

async function saveForm(ev) {
  ev.preventDefault();
  const res = core.validateSubmission(readForm());
  if (!res.ok) { showErrors(res.errors); return; }
  clearErrors();
  const done = await guarded(async () => {
    $('f-save').disabled = true;
    try { await (state.editingId ? state.backend.update(state.editingId, res.value) : state.backend.create(res.value)); }
    finally { $('f-save').disabled = false; }
  }, $('form-error'));
  if (done) $('form-dialog').close();
}

/* ---- preview / publish ---- */
function openPreview(rec, { publishId } = {}) {
  state.publishId = publishId || null;
  $('preview-error').textContent = '';
  $('preview-note').textContent = publishId ? 'Check how students will see this, then publish it.' : 'This is how students will see it.';
  $('preview-card').replaceChildren(h('ul', { class: 'cards', style: 'grid-template-columns:1fr' }, h('li', {}, renderCard({ ...rec, attachments: rec.attachments || [] }))));
  $('p-publish').hidden = !publishId;
  $('preview-dialog').showModal();
}
function previewFromForm() {
  const res = core.validateSubmission(readForm());
  if (!res.ok) { showErrors(res.errors); return; }
  openPreview({ id: 'preview', ...res.value }, {});
}
async function publishFromPreview() {
  const id = state.publishId;
  if (!id) return;
  const ok = await guarded(() => state.backend.setPublished(id, true), $('preview-error'));
  if (ok) $('preview-dialog').close();
}

/* ---- delete ---- */
function openDelete(rec) {
  state.deleteId = rec.id;
  $('confirm-text').textContent = `“${rec.subject} — ${rec.type}” and its PDF links will be removed for everyone. This cannot be undone.`;
  $('confirm-error').textContent = '';
  $('confirm-dialog').showModal();
}
async function confirmDelete() {
  const id = state.deleteId;
  if (!id) return;
  const ok = await guarded(() => state.backend.remove(id), $('confirm-error'));
  if (ok) $('confirm-dialog').close();
}

/* ================= Admin Management (owner only) ================= */
const ownerEmail = () => core.normalizeEmail(state.user && state.user.email);
const LS_IMPORT = 'mechReminders.importDismissed.v1';   // per-device convenience only
const importDismissed = () => { try { return localStorage.getItem(LS_IMPORT) === '1'; } catch (_) { return false; } };
function dismissImport() { try { localStorage.setItem(LS_IMPORT, '1'); } catch (_) { /* ignore */ } $('owner-import').hidden = true; }

function explainOwner(e) {
  const c = String((e && (e.code || e.message)) || '');
  if (/permission-denied/.test(c)) return 'Not allowed. Only the owner or an administrator with the “manage administrators” right can do that, and managers cannot change the owner, other managers or themselves. If you should be allowed, sign out and sign in again.';
  return explain(e);
}

function ownerMsg(kind, title, text) {
  const box = $('owner-msg');
  box.replaceChildren();
  if (!title && !text) return;
  box.append(h('div', { class: `notice ${kind}`, role: kind === 'error' ? 'alert' : null }, h('div', {}, title ? h('strong', {}, title) : null, text || '')));
}

function clearOwnerDom() {
  const d = $('owner-confirm-dialog'); if (d.open) d.close();
  $('owner-list').replaceChildren(); $('owner-msg').replaceChildren(); $('owner-email-err').textContent = ''; $('owner-form').reset();
  $('owner-import').hidden = true;
  state.ownerAction = null;
}

function renderOwner() {
  const panel = $('owner-panel');
  panel.hidden = !canManage();
  if (!canManage()) { clearOwnerDom(); return; }
  const me = ownerEmail();
  $('owner-badge').textContent = state.isOwner ? 'Owner only' : 'Manager';
  $('owner-hint').textContent = state.isOwner
    ? 'Only you (the owner) and administrators you give the “manage administrators” right can see this section. Everyone you add can manage Mech Reminders records after signing in with that Google account.'
    : 'You can add administrators and revoke, restore or remove ordinary administrators. You cannot change the owner, other managers or yourself.';
  const ul = $('owner-list');
  ul.replaceChildren(h('li', { class: 'admin-row', 'data-owner': 'true' },
    h('div', {},
      h('div', { class: 'title' }, core.OWNER_EMAIL, ' ', h('span', { class: 'badge owner' }, 'Owner'), ' ', h('span', { class: 'badge pub' }, 'Active')),
      h('div', { class: 'sub' }, 'Always has full access. It cannot be revoked, removed or changed by anyone.'))));
  if (!state.adminsLoaded) ul.append(h('li', { class: 'hint' }, 'Loading administrators…'));
  for (const a of core.sortAdmins(state.admins)) {
    const when = a.active ? (a.createdAt ? `Added ${core.formatCairo(a.createdAt)}` : 'Added just now')
      : (a.revokedAt ? `Access revoked ${core.formatCairo(a.revokedAt)}` : 'Access revoked');
    const locked = !state.isOwner && (a.canManage || a.email === me);       // managers cannot touch managers or themselves
    const actions = [];
    if (!locked) {
      actions.push(a.active
        ? h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-act': 'revoke', onclick: () => openOwnerConfirm('revoke', a.email) }, 'Revoke access')
        : h('button', { type: 'button', class: 'btn btn-sm', 'data-act': 'restore', onclick: () => restoreAdmin(a.email) }, 'Restore access'));
      actions.push(h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-act': 'remove', onclick: () => openOwnerConfirm('remove', a.email) }, 'Remove'));
    }
    if (state.isOwner) actions.push(h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-act': 'toggle-manager', onclick: () => setManager(a.email, !a.canManage) },
      a.canManage ? 'Remove manager right' : 'Allow managing admins'));
    ul.append(h('li', { class: `admin-row${a.active ? '' : ' is-revoked'}`, 'data-email': a.email, 'data-active': String(a.active), 'data-manager': String(a.canManage), 'data-locked': String(locked) },
      h('div', {},
        h('div', { class: 'title' }, a.email, ' ', h('span', { class: a.active ? 'badge pub' : 'badge revoked' }, a.active ? 'Active' : 'Revoked'),
          a.canManage ? [' ', h('span', { class: 'badge owner' }, 'Manager')] : null),
        h('div', { class: 'sub' }, when + (locked && a.email !== me ? ' · only the owner can change this entry' : ''))),
      actions.length ? h('div', { class: 'admin-actions' }, actions) : null));
  }
  if (state.adminsLoaded && !state.adminsError && !state.admins.length) ul.append(h('li', { class: 'hint', 'data-role': 'empty' }, 'No other administrators yet. Add an e-mail above.'));
  $('owner-import').hidden = !(state.isOwner && state.adminsLoaded && !state.adminsError && state.admins.length === 0) || importDismissed();
}

async function setManager(email, value) {
  if (!state.isOwner) return;
  ownerMsg();
  const done = await guarded(() => state.backend.setManager(email, value), (m) => ownerMsg('error', 'Could not change the manager right.', m), explainOwner);
  if (done) ownerMsg('info', value ? 'Manager right granted.' : 'Manager right removed.',
    value ? `${email} can now add administrators and revoke or remove ordinary ones.` : `${email} is now an ordinary administrator.`);
}

async function addAdmin(ev) {
  ev.preventDefault();
  if (!canManage()) return;
  const err = $('owner-email-err'); err.textContent = ''; ownerMsg();
  const res = core.checkNewAdminEmail($('owner-email').value, state.admins);
  if (!res.ok) { err.textContent = res.message; $('owner-email').focus(); return; }
  const done = await guarded(() => state.backend.addAdmin(res.email, ownerEmail()), (m) => ownerMsg('error', 'Could not add the administrator.', m), explainOwner);
  if (done) { $('owner-form').reset(); ownerMsg('info', 'Administrator added.', `${res.email} can now manage Mech Reminders after signing in with that Google account.`); }
}

async function importPreviousAdmins() {
  if (!state.isOwner) return;
  ownerMsg();
  const done = await guarded(() => state.backend.addAdmins(core.PREVIOUS_ADMINS.map((email) => ({ email, canManage: core.PREVIOUS_MANAGERS.includes(email) })), ownerEmail()), (m) => ownerMsg('error', 'Could not import the administrators.', m), explainOwner);
  if (done) ownerMsg('info', 'Previous administrators imported.', `${core.PREVIOUS_ADMINS.length} accounts keep their access.`);
}

async function restoreAdmin(email) {
  if (!canManage()) return;
  ownerMsg();
  const done = await guarded(() => state.backend.restoreAdmin(email), (m) => ownerMsg('error', 'Could not restore access.', m), explainOwner);
  if (done) ownerMsg('info', 'Access restored.', `${email} can manage Mech Reminders again.`);
}

function openOwnerConfirm(kind, email) {
  state.ownerAction = { kind, email };
  const revoke = kind === 'revoke';
  $('owner-confirm-title').textContent = revoke ? 'Revoke administrator access?' : 'Remove this administrator?';
  $('owner-confirm-text').textContent = revoke
    ? `${email} will immediately lose the ability to create, edit, publish or delete records. You can restore access later.`
    : `${email} will be removed from the list and lose access immediately. You can add the address again later.`;
  $('oc-confirm').textContent = revoke ? 'Revoke access' : 'Remove admin';
  $('owner-confirm-error').textContent = '';
  $('owner-confirm-dialog').showModal();
}

async function confirmOwnerAction() {
  const act = state.ownerAction;
  if (!act || !canManage()) return;
  const run = act.kind === 'revoke' ? () => state.backend.revokeAdmin(act.email, ownerEmail()) : () => state.backend.removeAdmin(act.email);
  const ok = await guarded(run, (m) => { $('owner-confirm-error').textContent = m; }, explainOwner);
  if (!ok) return;
  $('owner-confirm-dialog').close();
  ownerMsg('info', act.kind === 'revoke' ? 'Access revoked.' : 'Administrator removed.',
    act.kind === 'revoke' ? `${act.email} can no longer create, edit, publish or delete records.` : `${act.email} was removed from the list.`);
  state.ownerAction = null;
}

/* ================= sign in / out ================= */
async function signIn() {
  try { await state.backend.signIn(); }
  catch (e) { const m = explain(e); if (m) showStatus('error', 'Sign-in failed.', m); }
}
async function signOut() {
  try { await state.backend.signOut(); showStatus(); } catch (e) { showStatus('error', 'Sign-out failed.', explain(e)); }
}

/* ================= browser notifications (only while this page is open) ================= */
function loadSettings() {
  const def = { enabled: false, leads: core.DEFAULT_LEADS.slice() };
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null');
    if (s && typeof s.enabled === 'boolean' && Array.isArray(s.leads)) return { enabled: s.enabled, leads: s.leads.filter((n) => core.DEFAULT_LEADS.includes(n)) };
  } catch (_) { /* storage unavailable or corrupt → defaults */ }
  return def;
}
function saveSettings() { try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); } catch (_) { /* ignore */ } }
function loadFired() { try { return JSON.parse(localStorage.getItem(LS_FIRED) || '{}') || {}; } catch (_) { return {}; } }
function saveFired(f) { try { localStorage.setItem(LS_FIRED, JSON.stringify(f)); } catch (_) { /* ignore */ } }

const notifSupported = () => typeof window.Notification === 'function';

function wireNotifySettings() {
  const enable = $('n-enable'), leads = [...document.querySelectorAll('#n-leads input')], hint = $('n-hint');
  const base = hint.textContent;
  if (!notifSupported()) {
    enable.disabled = true; leads.forEach((i) => { i.disabled = true; });
    hint.textContent = 'This browser does not support notifications. Deadlines are still listed above. ' + base;
    return;
  }
  enable.checked = state.settings.enabled && Notification.permission === 'granted';
  leads.forEach((i) => { i.checked = state.settings.leads.includes(+i.value); });
  enable.addEventListener('change', async () => {
    if (enable.checked) {
      let perm = Notification.permission;
      if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (_) { perm = 'denied'; } }
      if (perm !== 'granted') { enable.checked = false; hint.textContent = 'Notifications are blocked for this site. Allow them in your browser settings, then try again. ' + base; return; }
      hint.textContent = base;
    }
    state.settings.enabled = enable.checked;
    saveSettings();
    checkReminders();
  });
  leads.forEach((i) => i.addEventListener('change', () => {
    state.settings.leads = leads.filter((x) => x.checked).map((x) => +x.value);
    saveSettings();
    checkReminders();
  }));
}

async function showNotification(title, body, tag) {
  const opts = { body, tag, icon: new URL('../icons/android-chrome-192.png', location.href).href };
  try {
    const reg = 'serviceWorker' in navigator
      ? await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 1200))]) : null;
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return; }
  } catch (_) { /* fall through to the page-level API */ }
  try { new Notification(title, opts); } catch (_) { /* some mobile browsers only allow the service-worker route */ }
}

function checkReminders() {
  if (!notifSupported() || !state.settings.enabled || Notification.permission !== 'granted' || !state.loaded) return;
  const fired = core.pruneFired(loadFired(), state.now);
  const res = core.dueReminders(published(), state.now, state.settings.leads, fired);
  saveFired(res.fired);
  for (const n of res.notify) {
    showNotification(`${n.sub.subject} — ${n.sub.type}`,
      `Deadline ${core.formatCairo(n.sub.deadline)} · ${core.formatDuration(n.remaining)} left.`, `mr-${n.sub.id}-${n.sub.deadline}`);
  }
}

/* ================= clock ================= */
function tick() {
  state.now = Date.now();
  if (signature() !== state.sig) renderAll(); else updateTimeLabels();
  checkReminders();
}

/* ================= start ================= */
async function init() {
  $('year').textContent = new Date().getFullYear();
  const update = () => document.body.classList.toggle('offline', !navigator.onLine);
  window.addEventListener('online', update); window.addEventListener('offline', update); update();

  if (!isConfigured()) {
    showStatus('warn', 'Mech Reminders is not connected to its database yet.',
      'The site owner still needs to finish the Firebase setup (see MECH-REMINDERS-SETUP.md). No deadlines are shown until then.');
    return;
  }

  $('board').hidden = false;
  $('f-type').replaceChildren(...typeOptions());
  const f = state.filters;
  wireSubjectPicker();
  $('flt-type').addEventListener('change', (e) => { f.type = e.target.value; renderList(); });
  $('flt-status').addEventListener('change', (e) => { f.status = e.target.value; renderList(); });
  $('flt-sort').addEventListener('change', (e) => { f.sort = e.target.value; renderList(); });
  wireNotifySettings();

  $('admin-new').addEventListener('click', () => openForm(null));
  $('form').addEventListener('submit', saveForm);
  $('f-cancel').addEventListener('click', () => $('form-dialog').close());
  $('f-preview').addEventListener('click', previewFromForm);
  $('f-add-att').addEventListener('click', () => {
    if ($('f-atts').children.length >= core.MAX_ATTACHMENTS) { $('e-attachments').textContent = `At most ${core.MAX_ATTACHMENTS} attachments.`; return; }
    const row = attRow(); $('f-atts').append(row); row.querySelector('input').focus();
  });
  $('p-close').addEventListener('click', () => $('preview-dialog').close());
  $('p-publish').addEventListener('click', publishFromPreview);
  $('c-cancel').addEventListener('click', () => $('confirm-dialog').close());
  $('c-delete').addEventListener('click', confirmDelete);
  $('owner-form').addEventListener('submit', addAdmin);
  $('owner-import-btn').addEventListener('click', importPreviousAdmins);
  $('owner-import-dismiss').addEventListener('click', dismissImport);
  $('oc-cancel').addEventListener('click', () => $('owner-confirm-dialog').close());
  $('oc-confirm').addEventListener('click', confirmOwnerAction);

  try { state.backend = await createBackend(FIREBASE_CONFIG); }
  catch (e) {
    $('board').hidden = true;
    showStatus('error', 'Could not load the Firebase library.', 'Check your connection and refresh the page.');
    return;
  }
  state.backend.onAuth(onAuth);               // fires once at start, then on every sign-in / sign-out
  setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
}

init();
