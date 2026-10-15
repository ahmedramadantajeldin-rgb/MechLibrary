/* Mech Reminders — UI.
 * Public visitors read PUBLISHED records. Administrators (verified Google account on the allowlist) also get the
 * dashboard. The allowlist below only decides what the page SHOWS; the real gate is firestore.rules on the server. */
import * as core from './core.js';
import { FIREBASE_CONFIG, isConfigured } from './firebase-config.js';
import { createBackend } from './backend.js';

const ADMIN_HINT = ['ahmedramadantajeldin@gmail.com', 'ahmedyasserr219@gmail.com'];   // UI hint only — keep in sync with firestore.rules
const TICK_MS = 30 * 1000;
const LS_SETTINGS = 'mechReminders.settings.v1';   // per-device notification preferences (not shared data)
const LS_FIRED = 'mechReminders.fired.v1';
const LS_COURSES = 'mechReminders.selectedCourses.v1';

function loadSelectedCourses() {
  try {
    const raw = localStorage.getItem(LS_COURSES);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map((s) => String(s).trim()).filter(Boolean) : [];
  } catch (_) { return []; }
}
function saveSelectedCourses(courses) {
  try { localStorage.setItem(LS_COURSES, JSON.stringify(courses)); } catch (_) { /* ignore */ }
}

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

const state = {
  backend: null, user: null, isAdmin: false,
  records: [], loaded: false, unsub: null,
  selectedCourses: loadSelectedCourses(),
  now: Date.now(), sig: '',
  editingId: null, publishId: null, deleteId: null, busy: false,
  settings: loadSettings()
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
  if (/permission-denied/.test(c)) return 'Not allowed. Only the two authorized administrator accounts can change Mech Reminders.';
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
    state.loaded = true; state.records = [];
    showStatus('error', state.isAdmin ? 'Could not load the records.' : 'Could not load deadlines.', explain(e) || 'Try again in a moment.');
    renderAll();
  };
  try { state.unsub = (state.isAdmin ? state.backend.watchAll : state.backend.watchPublished)(ok, err); } catch (e) { err(e); }
  renderAll();
}

function onAuth(user) {
  state.user = user;
  state.isAdmin = !!user && user.verified && ADMIN_HINT.includes(user.email.toLowerCase());
  renderAccount();
  startWatching();
}

/* ================= rendering ================= */
function renderAll() { renderStats(); renderCourseFilters(); renderList(); renderAdmin(); state.sig = signature(); }

function signature() {
  const sel = state.selectedCourses.join(',');
  const recs = state.records.map((r) => { const t = core.timeInfo(r, state.now); return `${r.id}:${t.status}:${t.urgency}:${r.published}:${r.closesAt}`; }).join('|');
  return `${sel}#${recs}`;
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
  box.append(
    h('span', { class: 'who' }, `Signed in as ${state.user.email}`,
      state.isAdmin ? '' : ' — this account is not authorized to manage Mech Reminders.'),
    h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: signOut }, 'Sign out'));
}

function renderStats() {
  const c = { upcoming: 0, overdue: 0, past: 0 };
  const items = state.selectedCourses.length
    ? published().filter((r) => state.selectedCourses.some((s) => s.toLowerCase() === r.subject.toLowerCase()))
    : [];
  items.forEach((r) => { c[core.statusOf(r, state.now)]++; });
  const ready = state.loaded;
  $('stat-upcoming').textContent = ready ? (state.selectedCourses.length ? c.upcoming : 0) : '–';
  $('stat-overdue').textContent = ready ? (state.selectedCourses.length ? c.overdue : 0) : '–';
  $('stat-past').textContent = ready ? (state.selectedCourses.length ? c.past : 0) : '–';
}

function renderCourseFilters() {
  const container = $('courses-chips');
  const countEl = $('courses-count');
  if (!container) return;

  const subjects = core.subjectsOf(published());
  const activeCount = subjects.filter((s) => state.selectedCourses.some((sel) => sel.toLowerCase() === s.toLowerCase())).length;
  if (countEl) {
    countEl.textContent = `${activeCount} of ${subjects.length} selected`;
  }

  container.replaceChildren();

  if (!subjects.length) {
    container.append(h('span', { class: 'hint' }, state.loaded ? 'No courses with published deadlines yet.' : 'Loading courses…'));
    return;
  }

  subjects.forEach((subj) => {
    const isSelected = state.selectedCourses.some((s) => s.toLowerCase() === subj.toLowerCase());
    const checkbox = h('input', {
      type: 'checkbox',
      value: subj,
      checked: isSelected,
      'aria-label': subj,
      onchange: (e) => toggleCourse(subj, e.target.checked)
    });

    const label = h('label', { class: `course-chip${isSelected ? ' active' : ''}` },
      checkbox,
      h('span', {}, subj)
    );

    container.append(label);
  });
}

function toggleCourse(subj, checked) {
  const cur = state.selectedCourses.filter((s) => s.toLowerCase() !== subj.toLowerCase());
  if (checked) cur.push(subj);
  state.selectedCourses = cur;
  saveSelectedCourses(state.selectedCourses);
  renderAll();
}

function selectAllCourses() {
  const all = core.subjectsOf(published());
  state.selectedCourses = all.slice();
  saveSelectedCourses(state.selectedCourses);
  renderAll();
}

function clearAllCourses() {
  state.selectedCourses = [];
  saveSelectedCourses(state.selectedCourses);
  renderAll();
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

  if (!state.loaded) {
    list.append(h('p', { class: 'empty', role: 'status' }, 'Loading deadlines…'));
    return;
  }

  const allPublished = published();
  if (!allPublished.length) {
    empty.textContent = 'No deadlines have been published yet.';
    empty.hidden = false;
    return;
  }

  if (!state.selectedCourses.length) {
    list.append(h('div', { class: 'empty-courses', role: 'region', 'aria-label': 'Select courses prompt' },
      h('p', {}, h('strong', {}, 'No courses selected.')),
      h('p', {}, 'Select your courses above to see your upcoming deadlines and reminders.'),
      h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: selectAllCourses }, 'Select all courses')));
    return;
  }

  const items = core.filterAndSort(allPublished, state.selectedCourses, state.now);
  if (!items.length) {
    empty.textContent = 'No submissions match your selected courses.';
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
  const dl = h('dl', { class: 'dates' },
    h('dt', {}, 'Deadline'), h('dd', {}, core.formatCairo(r.deadline)));
  if (r.closesAt != null) {
    dl.append(h('dt', {}, 'Closes'), h('dd', {}, core.formatCairo(r.closesAt)));
  }
  return h('article', { class: 'sub-card', 'data-id': r.id, 'data-status': t.status, 'data-urgency': t.urgency },
    h('div', { class: 'sub-head' },
      h('h3', {}, r.subject),
      h('span', { class: 'badge type' }, r.type)),
    r.courseCode ? h('p', { class: 'sub-code' }, r.courseCode) : null,
    dl,
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
function renderAdmin() {
  const panel = $('admin');
  panel.hidden = !state.isAdmin;
  if (!state.isAdmin) { clearAdminDom(); return; }
  const ul = $('admin-list');
  ul.replaceChildren();
  if (!state.loaded) { ul.append(h('li', { class: 'hint' }, 'Loading…')); return; }
  const rows = [...state.records].sort((a, b) => b.deadline - a.deadline);
  if (!rows.length) ul.append(h('li', { class: 'hint' }, 'No records yet. Use “New submission” to add the first one.'));
  for (const r of rows) {
    const st = { upcoming: 'Upcoming', overdue: 'Deadline passed, still open', past: 'Closed' }[core.statusOf(r, state.now)];
    const closesPart = r.closesAt != null ? ` · Closes ${core.formatCairo(r.closesAt)}` : '';
    ul.append(h('li', { class: 'admin-row', 'data-id': r.id },
      h('div', {},
        h('div', { class: 'title' }, r.subject, ' ', h('span', { class: 'badge type' }, r.type), ' ',
          h('span', { class: r.published ? 'badge pub' : 'badge draft' }, r.published ? 'Published' : 'Draft')),
        h('div', { class: 'sub' }, `Deadline ${core.formatCairo(r.deadline)}${closesPart} · ${r.attachments.length} PDF link${r.attachments.length === 1 ? '' : 's'} · ${st}`)),
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

async function guarded(fn, errBox) {
  if (state.busy) return false;
  state.busy = true;
  if (errBox) errBox.textContent = '';
  try { await fn(); return true; }
  catch (e) {
    const msg = explain(e);
    if (errBox) errBox.textContent = msg; else showStatus('error', 'That did not work.', msg);
    return false;
  } finally { state.busy = false; }
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
  $('f-closes').value = rec && rec.closesAt != null ? core.toCairoInputValue(rec.closesAt) : '';
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
  const relevant = state.selectedCourses.length
    ? published().filter((r) => state.selectedCourses.some((s) => s.toLowerCase() === r.subject.toLowerCase()))
    : published();
  const res = core.dueReminders(relevant, state.now, state.settings.leads, fired);
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
  const btnSelectAll = $('btn-select-all');
  if (btnSelectAll) btnSelectAll.addEventListener('click', selectAllCourses);
  const btnClearAll = $('btn-clear-all');
  if (btnClearAll) btnClearAll.addEventListener('click', clearAllCourses);
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
