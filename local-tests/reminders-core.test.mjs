// Run from the repository root:  node --test local-tests/reminders-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../reminders/core.js';

const H = 3600e3, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();

test('Cairo wall time → UTC (winter UTC+2, summer UTC+3)', () => {
  assert.equal(iso(c.parseCairoLocal('2026-01-15T12:00')), '2026-01-15T10:00:00.000Z');
  assert.equal(iso(c.parseCairoLocal('2026-07-01T12:00')), '2026-07-01T09:00:00.000Z');
});

test('round trip through the datetime-local format', () => {
  for (const s of ['2026-01-15T23:59', '2026-07-01T00:00', '2026-12-31T08:05']) {
    assert.equal(c.toCairoInputValue(c.parseCairoLocal(s)), s);
  }
});

test('spring-forward gap does not exist → null; hour after the gap is fine', () => {
  // Egypt DST starts on the last Friday of April at 00:00 (clocks jump to 01:00): 24 Apr 2026
  assert.equal(c.parseCairoLocal('2026-04-24T00:30'), null);
  assert.notEqual(c.parseCairoLocal('2026-04-24T01:30'), null);
  assert.equal(iso(c.parseCairoLocal('2026-04-24T01:30')), '2026-04-23T22:30:00.000Z');
});

test('autumn overlap resolves to a real instant that round-trips', () => {
  // DST ends on the last Thursday of October at 24:00 (clocks go back to 23:00): 29 Oct 2026
  const t = c.parseCairoLocal('2026-10-29T23:30');
  assert.notEqual(t, null);
  assert.equal(c.toCairoInputValue(t), '2026-10-29T23:30');
});

test('malformed or impossible input → null', () => {
  for (const s of ['', null, undefined, '2026-02-30T10:00', '2026-13-01T10:00', '2026-01-01 10:00', '2026-01-01T24:00', 'abc']) {
    assert.equal(c.parseCairoLocal(s), null, String(s));
  }
});

const sub = (over = {}) => ({ id: 'a', subject: 'Heat Transfer', type: 'Quiz', deadline: 1000 * H, closesAt: 1002 * H, attachments: [], ...over });

test('status: upcoming / overdue / past — boundaries', () => {
  const s = sub();
  assert.equal(c.statusOf(s, 1000 * H - 1), 'upcoming');
  assert.equal(c.statusOf(s, 1000 * H), 'overdue');
  assert.equal(c.statusOf(s, 1002 * H - 1), 'overdue');
  assert.equal(c.statusOf(s, 1002 * H), 'past');
  // deadline == closing time → no overdue window
  const same = sub({ closesAt: 1000 * H });
  assert.equal(c.statusOf(same, 1000 * H), 'past');
});

test('urgency thresholds and wording never mention submission state', () => {
  const s = sub({ deadline: 100 * D, closesAt: 101 * D });
  assert.equal(c.timeInfo(s, 100 * D - 2 * H).urgency, 'urgent');
  assert.equal(c.timeInfo(s, 100 * D - 2 * D).urgency, 'soon');
  assert.equal(c.timeInfo(s, 100 * D - 10 * D).urgency, 'normal');
  const od = c.timeInfo(s, 100 * D + 3 * H);
  assert.equal(od.status, 'overdue');
  assert.doesNotMatch(od.label, /submitted|late|missed|failed/i);
  assert.doesNotMatch(c.timeInfo(s, 102 * D).label, /submitted|missed|failed/i);
});

test('formatDuration', () => {
  assert.equal(c.formatDuration(2 * D + 5 * H), '2d 5h');
  assert.equal(c.formatDuration(5 * H + 12 * 60000), '5h 12m');
  assert.equal(c.formatDuration(12 * 60000), '12m');
  assert.equal(c.formatDuration(10), 'under 1m');
  assert.equal(c.formatDuration(-5), 'under 1m');
});

test('filter by subject (case-insensitive), type, status; all seven types accepted', () => {
  const now = 500 * H;
  const list = [
    sub({ id: '1', subject: 'Heat Transfer', type: 'Quiz', deadline: 600 * H, closesAt: 601 * H }),
    sub({ id: '2', subject: 'heat transfer', type: 'Midterm', deadline: 400 * H, closesAt: 600 * H }),
    sub({ id: '3', subject: 'Fluid Mechanics II', type: 'M Project', deadline: 300 * H, closesAt: 310 * H })
  ];
  assert.deepEqual(c.filterAndSort(list, { subject: 'HEAT TRANSFER', type: 'all', status: 'all', sort: 'smart' }, now).map((s) => s.id), ['1', '2']);
  assert.deepEqual(c.filterAndSort(list, { subject: 'all', type: 'Midterm', status: 'all', sort: 'smart' }, now).map((s) => s.id), ['2']);
  assert.deepEqual(c.filterAndSort(list, { subject: 'all', type: 'all', status: 'past', sort: 'smart' }, now).map((s) => s.id), ['3']);
  assert.deepEqual(c.subjectsOf(list), ['Fluid Mechanics II', 'Heat Transfer']);
  assert.deepEqual(c.TYPES, ['Assignment', 'Quiz', 'Midterm', 'M Assignment', 'M Quiz', 'M Midterm', 'M Project']);
});

test('sorting: smart = upcoming, overdue, then past (most recent first); explicit orders', () => {
  const now = 500 * H;
  const list = [
    sub({ id: 'past-old', deadline: 100 * H, closesAt: 101 * H }),
    sub({ id: 'up-late', deadline: 900 * H, closesAt: 901 * H }),
    sub({ id: 'past-new', deadline: 300 * H, closesAt: 301 * H }),
    sub({ id: 'up-soon', deadline: 510 * H, closesAt: 511 * H }),
    sub({ id: 'over', deadline: 490 * H, closesAt: 520 * H })
  ];
  const f = (sort) => c.filterAndSort(list, { subject: 'all', type: 'all', status: 'all', sort }, now).map((s) => s.id);
  assert.deepEqual(f('smart'), ['up-soon', 'up-late', 'over', 'past-new', 'past-old']);
  assert.deepEqual(f('deadline-asc'), ['past-old', 'past-new', 'over', 'up-soon', 'up-late']);
  assert.deepEqual(f('deadline-desc'), ['up-late', 'up-soon', 'over', 'past-new', 'past-old']);
});

const goodForm = (over = {}) => ({
  subject: ' Heat Transfer ', type: 'Quiz', courseCode: '', description: '',
  deadline: '2026-11-01T23:59', closesAt: '2026-11-02T10:00',
  attachments: [{ title: 'Sheet 1', url: 'https://example.com/a.pdf', description: '' }, { title: '', url: '', description: '' }],
  published: false, ...over
});

test('validation: a good form passes, trims, drops blank attachment rows', () => {
  const r = c.validateSubmission(goodForm());
  assert.equal(r.ok, true);
  assert.equal(r.value.subject, 'Heat Transfer');
  assert.equal(r.value.attachments.length, 1);
  assert.ok(r.value.closesAt > r.value.deadline);
});

test('validation: every one of the seven types is accepted, others rejected', () => {
  for (const t of c.TYPES) assert.equal(c.validateSubmission(goodForm({ type: t })).ok, true, t);
  for (const t of ['', 'Exam', 'quiz', 'Project']) assert.ok(c.validateSubmission(goodForm({ type: t })).errors.type, t);
});

test('validation: deadline and closing time are separate and ordered', () => {
  assert.ok(c.validateSubmission(goodForm({ deadline: '', closesAt: '' })).errors.deadline);
  assert.ok(c.validateSubmission(goodForm({ deadline: '', closesAt: '' })).errors.closesAt);
  assert.ok(c.validateSubmission(goodForm({ closesAt: '2026-11-01T10:00' })).errors.closesAt);        // earlier than deadline
  assert.equal(c.validateSubmission(goodForm({ closesAt: '2026-11-01T23:59' })).ok, true);              // equal is allowed (kept as two values)
  assert.ok(c.validateSubmission(goodForm({ deadline: '2026-04-24T00:30' })).errors.deadline);        // DST gap
});

test('validation: required subject, attachment title and https URL', () => {
  assert.ok(c.validateSubmission(goodForm({ subject: '   ' })).errors.subject);
  const bad = (url) => c.validateSubmission(goodForm({ attachments: [{ title: 'x', url, description: '' }] }));
  for (const u of ['http://example.com/a.pdf', 'javascript:alert(1)', 'ftp://x.com/a', 'example.com/a.pdf', 'https://', 'https://a b.com/x', 'data:text/html,hi']) {
    assert.ok(bad(u).errors['attachments.0.url'], u);
  }
  assert.equal(bad('https://drive.google.com/file/d/abc/view').ok, true);
  assert.ok(c.validateSubmission(goodForm({ attachments: [{ title: '', url: 'https://e.com/a.pdf', description: '' }] })).errors['attachments.0.title']);
  const many = Array.from({ length: 11 }, (_, i) => ({ title: 't' + i, url: 'https://e.com/' + i, description: '' }));
  assert.ok(c.validateSubmission(goodForm({ attachments: many })).errors.attachments);
});

test('reminders: fires once per record, only the tightest crossed lead, never twice', () => {
  const leads = [D, 3 * H, H];
  const s = sub({ id: 'x', deadline: 1000 * H, closesAt: 1001 * H });
  let r = c.dueReminders([s], 1000 * H - 2 * D, leads, {});
  assert.equal(r.notify.length, 0);                                    // nothing crossed yet
  r = c.dueReminders([s], 1000 * H - 23 * H, leads, r.fired);
  assert.equal(r.notify.length, 1); assert.equal(r.notify[0].lead, D); // 24 h lead
  let again = c.dueReminders([s], 1000 * H - 22 * H, leads, r.fired);
  assert.equal(again.notify.length, 0);                                // no duplicate
  again = c.dueReminders([s], 1000 * H - 2.5 * H, leads, again.fired);
  assert.equal(again.notify.length, 1); assert.equal(again.notify[0].lead, 3 * H);
  // opening the page late (30 min left, nothing fired before): ONE notification, not three
  const late = c.dueReminders([s], 1000 * H - 0.5 * H, leads, {});
  assert.equal(late.notify.length, 1); assert.equal(late.notify[0].lead, H);
  // after the deadline: no reminder
  assert.equal(c.dueReminders([s], 1000 * H + 1, leads, {}).notify.length, 0);
  // changing a deadline re-arms the reminder
  const moved = { ...s, deadline: 1100 * H, closesAt: 1101 * H };
  assert.equal(c.dueReminders([moved], 1100 * H - 0.5 * H, leads, late.fired).notify.length, 1);
});

test('pruneFired drops old entries only', () => {
  const out = c.pruneFired({ old: 0, fresh: 100 * D }, 100 * D + H);
  assert.deepEqual(Object.keys(out), ['fresh']);
});

test('shipped Firebase config: complete, matches the mechhub-reminders project, no placeholders', async () => {
  const m = await import('../reminders/firebase-config.js');
  assert.equal(m.isConfigured(), true);
  assert.equal(m.FIREBASE_CONFIG.projectId, 'mechhub-reminders');
  assert.equal(m.FIREBASE_CONFIG.authDomain, 'mechhub-reminders.firebaseapp.com');
  assert.equal(m.FIREBASE_CONFIG.appId, '1:351195022792:web:70969d45b9e8eed61bacfd');
  assert.ok(Object.values(m.FIREBASE_CONFIG).every((v) => !/REPLACE_ME/.test(v)));
});
