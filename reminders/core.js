/* Mech Reminders — pure logic (no DOM, no Firebase). Unit-tested in local-tests/reminders-core.test.mjs */

export const TZ = 'Africa/Cairo';               // every date is entered and shown in this zone
export const TYPES = ['Assignment', 'Quiz', 'Midterm', 'M Assignment', 'M Quiz', 'M Midterm', 'M Project'];
export const MAX_ATTACHMENTS = 10;               // must match firestore.rules
export const LIMITS = { subject: 120, courseCode: 40, description: 1000, attTitle: 120, attDesc: 300, url: 2000 };

const HOUR = 3600e3;
const DAY = 24 * HOUR;
export const URGENT_MS = DAY;                    // < 24 h  → urgent
export const SOON_MS = 3 * DAY;                  // < 72 h  → soon
export const DEFAULT_LEADS = [DAY, 3 * HOUR, HOUR];

/* ---------- Time zone helpers (Africa/Cairo, DST-aware via Intl) ---------- */
const wallFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});
function wallParts(ms) {
  const o = {};
  for (const p of wallFmt.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = +p.value;
  return o;
}
const wallAsUTC = (ms) => { const p = wallParts(ms); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second); };

/** 'YYYY-MM-DDTHH:mm' typed as Cairo wall-clock time → epoch ms. Returns null if malformed or the time
 *  does not exist (skipped by the spring-forward DST change). In the autumn overlap either instant may be returned. */
export function parseCairoLocal(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(str || '');
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUTC = Date.UTC(y, mo - 1, d, h, mi);
  const chk = new Date(asUTC);
  if (h > 23 || mi > 59 || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  const t0 = asUTC - (wallAsUTC(asUTC) - asUTC);
  const t1 = asUTC - (wallAsUTC(t0) - t0);
  if (wallAsUTC(t1) === asUTC) return t1;
  if (wallAsUTC(t0) === asUTC) return t0;
  return null;
}

/** epoch ms → 'YYYY-MM-DDTHH:mm' in Cairo wall-clock time (for <input type="datetime-local">). */
export function toCairoInputValue(ms) {
  const p = wallParts(ms), z = (n) => String(n).padStart(2, '0');
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

const showFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true
});
export const formatCairo = (ms) => showFmt.format(new Date(ms));

/* ---------- Status & countdown ---------- */
/** upcoming: before the official deadline · overdue: deadline passed but the window is still open · past: window closed */
export function statusOf(s, now) {
  if (now < +s.deadline) return 'upcoming';
  if (now < +s.closesAt) return 'overdue';
  return 'past';
}

export function formatDuration(ms) {
  ms = Math.max(0, ms);
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.floor((ms % HOUR) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return 'under 1m';
}

/** Wording never claims anything about whether the student submitted. */
export function timeInfo(s, now) {
  const status = statusOf(s, now), d = +s.deadline, c = +s.closesAt;
  if (status === 'upcoming') {
    const left = d - now;
    return { status, urgency: left < URGENT_MS ? 'urgent' : left < SOON_MS ? 'soon' : 'normal', label: `${formatDuration(left)} left until the deadline` };
  }
  if (status === 'overdue') {
    return { status, urgency: 'overdue', label: `Deadline passed ${formatDuration(now - d)} ago · window closes in ${formatDuration(c - now)}` };
  }
  return { status, urgency: 'none', label: `Closed ${formatDuration(now - c)} ago` };
}

/* ---------- Filtering & sorting ---------- */
const norm = (s) => String(s || '').trim().toLowerCase();

export function subjectsOf(list) {
  const seen = new Map();
  for (const s of list) { const k = norm(s.subject); if (k && !seen.has(k)) seen.set(k, s.subject.trim()); }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** f = { subject:'all'|name, type:'all'|TYPE, status:'all'|'upcoming'|'overdue'|'past', sort:'smart'|'deadline-asc'|'deadline-desc'|'subject' } */
export function filterAndSort(list, f, now) {
  const out = list.filter((s) =>
    (f.subject === 'all' || norm(s.subject) === norm(f.subject)) &&
    (f.type === 'all' || s.type === f.type) &&
    (f.status === 'all' || statusOf(s, now) === f.status));
  const rank = { upcoming: 0, overdue: 1, past: 2 };
  const by = {
    'deadline-asc': (a, b) => a.deadline - b.deadline,
    'deadline-desc': (a, b) => b.deadline - a.deadline,
    subject: (a, b) => a.subject.localeCompare(b.subject) || a.deadline - b.deadline,
    smart: (a, b) => {
      const sa = statusOf(a, now), sb = statusOf(b, now);
      if (sa !== sb) return rank[sa] - rank[sb];
      return sa === 'past' ? b.deadline - a.deadline : a.deadline - b.deadline;   // nearest first; most recent first for past
    }
  };
  return out.sort(by[f.sort] || by.smart);
}

/* ---------- Validation ---------- */
export function isHttpsUrl(u) {
  if (typeof u !== 'string' || u.length > LIMITS.url || /\s/.test(u)) return false;
  try { const x = new URL(u); return x.protocol === 'https:' && !!x.hostname; } catch (_) { return false; }
}

/** form = { subject, type, courseCode, description, deadline:'YYYY-MM-DDTHH:mm', closesAt:'…', attachments:[{title,url,description}], published }
 *  → { ok, errors:{ field: message }, value } — value holds epoch-ms dates and cleaned attachments. */
export function validateSubmission(form) {
  const errors = {};
  const subject = String(form.subject || '').trim();
  const courseCode = String(form.courseCode || '').trim();
  const description = String(form.description || '').trim();
  if (!subject) errors.subject = 'Enter the subject name.';
  else if (subject.length > LIMITS.subject) errors.subject = `Keep the subject under ${LIMITS.subject} characters.`;
  if (!TYPES.includes(form.type)) errors.type = 'Choose a submission type.';
  if (courseCode.length > LIMITS.courseCode) errors.courseCode = `Keep the course code under ${LIMITS.courseCode} characters.`;
  if (description.length > LIMITS.description) errors.description = `Keep the description under ${LIMITS.description} characters.`;

  const deadline = parseCairoLocal(form.deadline), closesAt = parseCairoLocal(form.closesAt);
  if (deadline == null) errors.deadline = form.deadline ? 'This time does not exist in Cairo (clocks skip forward). Pick another.' : 'Set the official deadline.';
  if (closesAt == null) errors.closesAt = form.closesAt ? 'This time does not exist in Cairo (clocks skip forward). Pick another.' : 'Set the closing / end time.';
  if (deadline != null && closesAt != null && closesAt < deadline) errors.closesAt = 'The closing time cannot be earlier than the deadline.';

  const attachments = [];
  (form.attachments || []).forEach((a, i) => {
    const title = String(a.title || '').trim(), url = String(a.url || '').trim(), desc = String(a.description || '').trim();
    if (!title && !url && !desc) return;                       // blank row → ignored
    const idx = attachments.length;
    if (attachments.length >= MAX_ATTACHMENTS) { errors['attachments'] = `At most ${MAX_ATTACHMENTS} attachments.`; return; }
    if (!title) errors[`attachments.${i}.title`] = 'Give the PDF a title.';
    else if (title.length > LIMITS.attTitle) errors[`attachments.${i}.title`] = `Keep the title under ${LIMITS.attTitle} characters.`;
    if (!isHttpsUrl(url)) errors[`attachments.${i}.url`] = 'Enter a full https:// link.';
    if (desc.length > LIMITS.attDesc) errors[`attachments.${i}.description`] = `Keep the note under ${LIMITS.attDesc} characters.`;
    attachments.push({ title, url, description: desc, _row: i, _idx: idx });
  });

  const ok = Object.keys(errors).length === 0;
  return {
    ok, errors,
    value: ok ? {
      subject, type: form.type, courseCode, description, deadline, closesAt,
      attachments: attachments.map(({ title, url, description: d }) => ({ title, url, description: d })),
      published: form.published === true
    } : null
  };
}

/* ---------- Administrator management (owner only) ---------- */
/** The one fixed owner. UI HINT ONLY — it decides what the page shows. The real gate is ownerEmail() in firestore.rules. */
export const OWNER_EMAIL = 'ahmedramadantajeldin@gmail.com';

/** One-time import helper for the owner panel: the administrators that existed before the list moved into Firestore.
 *  NEVER used to authorize anything — it only pre-fills documents in the admin list the first time the owner clicks the import button. */
export const PREVIOUS_ADMINS = ['ahmedyasserr219@gmail.com', 'mohamed.ibrahim200600@gmail.com', 'ahmedtageldien83@gmail.com'];

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();

/** Same shape as the rule in firestore.rules: "name", one "at" sign, "host.tld"; no spaces, no extra at-signs or slashes, at most 254 characters. */
export function isValidEmail(e) {
  const v = normalizeEmail(e);
  return v.length >= 5 && v.length <= 254 && /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v);
}

/** Checks a typed e-mail against the current list. admins = [{ email, active }].
 *  → { ok:true, email } or { ok:false, code:'invalid'|'owner'|'exists'|'revoked', message, email? } */
export function checkNewAdminEmail(input, admins) {
  const email = normalizeEmail(input);
  if (!email) return { ok: false, code: 'invalid', message: 'Enter an e-mail address.' };
  if (!isValidEmail(email)) return { ok: false, code: 'invalid', message: 'That does not look like a valid e-mail address.' };
  if (email === normalizeEmail(OWNER_EMAIL)) return { ok: false, code: 'owner', message: 'This is the owner account. It always has full access and is not part of the list.' };
  const hit = (admins || []).find((a) => normalizeEmail(a.email) === email);
  if (hit && hit.active) return { ok: false, code: 'exists', email, message: `${email} is already an administrator.` };
  if (hit) return { ok: false, code: 'revoked', email, message: `${email} was revoked earlier. Use “Restore access” on that row instead.` };
  return { ok: true, email };
}

/** Admins sorted: active first, then by e-mail. */
export const sortAdmins = (list) => [...list].sort((a, b) => (b.active - a.active) || a.email.localeCompare(b.email));

/* ---------- Browser-notification scheduling (used only while the page is open) ---------- */
/** For each upcoming record, find reminder lead-times already crossed. Emit ONE notification (for the tightest
 *  crossed lead) and mark every crossed lead as fired, so opening the page late never produces a burst. */
export function dueReminders(list, now, leads, fired) {
  const notify = [], nextFired = { ...fired };
  const sorted = [...leads].sort((a, b) => b - a);
  for (const s of list) {
    if (!(now < +s.deadline)) continue;
    const crossed = sorted.filter((L) => +s.deadline - L <= now);
    if (!crossed.length) continue;
    const keys = crossed.map((L) => `${s.id}|${+s.deadline}|${L}`);
    if (keys.every((k) => nextFired[k])) continue;
    if (keys.some((k) => !nextFired[k])) notify.push({ sub: s, lead: crossed[crossed.length - 1], remaining: +s.deadline - now });
    keys.forEach((k) => { nextFired[k] = now; });
  }
  return { notify, fired: nextFired };
}

export function pruneFired(fired, now, maxAge = 30 * DAY) {
  const out = {};
  for (const [k, t] of Object.entries(fired || {})) if (now - t < maxAge) out[k] = t;
  return out;
}
