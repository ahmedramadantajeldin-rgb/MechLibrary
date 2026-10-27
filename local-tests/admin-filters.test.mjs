// Run from the repository root:  node --test local-tests/admin-filters.test.mjs
// Tests the admin filtering, searching, sorting, and closesAt-optional logic using core.js helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../reminders/core.js';

const H = 3600e3, D = 24 * H;
const FAR_FUTURE = Date.now() + 60 * D;
const PAST = Date.now() - 10 * D;

// ─── Test data ──────────────────────────────────────────────────────────────────
function rec(id, overrides = {}) {
  return {
    id,
    subject: 'Heat Transfer',
    type: 'Assignment',
    courseCode: 'ME301',
    description: 'Chapter 5 problems',
    deadline: FAR_FUTURE,
    closesAt: null,
    attachments: [],
    published: true,
    createdAt: Date.now() - 5 * D,
    ...overrides
  };
}

const RECORDS = [
  rec('r1', { subject: 'Heat Transfer', type: 'Assignment', courseCode: 'ME301', deadline: FAR_FUTURE, createdAt: Date.now() - 5 * D }),
  rec('r2', { subject: 'Thermodynamics', type: 'Quiz', courseCode: 'ME201', deadline: FAR_FUTURE + D, createdAt: Date.now() - 3 * D }),
  rec('r3', { subject: 'Heat Transfer', type: 'M Project', courseCode: 'ME301', deadline: PAST, closesAt: PAST + 2 * H, published: false, createdAt: Date.now() - 10 * D }),
  rec('r4', { subject: 'Fluid Mechanics', type: 'Midterm', courseCode: 'ME202', deadline: PAST, closesAt: null, createdAt: Date.now() - 1 * D, description: 'Final exam preparation' }),
  rec('r5', { subject: 'thermodynamics', type: 'M Assignment', courseCode: 'ME201', deadline: FAR_FUTURE + 2 * D, createdAt: Date.now() - 2 * D }),
  rec('r6', { subject: 'Dynamics', type: 'M Quiz', courseCode: 'ME102', deadline: FAR_FUTURE - 1 * H, createdAt: Date.now() }),
  rec('r7', { subject: 'Statics', type: 'M Midterm', courseCode: '', deadline: PAST - 5 * D, closesAt: PAST - 4 * D, published: true, createdAt: Date.now() - 20 * D }),
];

const now = Date.now();

// ─── Helper: simulate adminFilteredRecords (mirrors reminders.js logic) ─────────
function adminFilter(records, filters, now_) {
  const f = { subject: 'all', type: 'all', status: 'all', sort: 'smart', search: '', ...filters };
  const t = now_ || now;
  let rows = [...records];
  if (f.subject && f.subject !== 'all') {
    const w = f.subject.trim().toLowerCase();
    rows = rows.filter((r) => (r.subject || '').trim().toLowerCase() === w);
  }
  if (f.type && f.type !== 'all') rows = rows.filter((r) => r.type === f.type);
  if (f.status === 'published') rows = rows.filter((r) => r.published);
  else if (f.status === 'draft') rows = rows.filter((r) => !r.published);
  else if (f.status && f.status !== 'all') rows = rows.filter((r) => c.statusOf(r, t) === f.status);
  if (f.search) rows = rows.filter((r) => c.searchMatches(r, f.search));
  const by = {
    'deadline-asc': (a, b) => (a.deadline || 0) - (b.deadline || 0),
    'deadline-desc': (a, b) => (b.deadline || 0) - (a.deadline || 0),
    'newest': (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    'subject': (a, b) => (a.subject || '').localeCompare(b.subject || '') || (a.deadline || 0) - (b.deadline || 0),
    'smart': (a, b) => {
      const sa = c.statusOf(a, t), sb = c.statusOf(b, t);
      const rank = { upcoming: 0, overdue: 1, past: 2 };
      if (sa !== sb) return (rank[sa] ?? 3) - (rank[sb] ?? 3);
      return sa === 'past' ? (b.deadline || 0) - (a.deadline || 0) : (a.deadline || 0) - (b.deadline || 0);
    }
  };
  return rows.sort(by[f.sort] || by.smart);
}
const ids = (rows) => rows.map((r) => r.id);

// ═════════════════════════════════════════════════════════════════════════════════
// 1. Search
// ═════════════════════════════════════════════════════════════════════════════════
test('search: by subject name (case-insensitive)', () => {
  const res = adminFilter(RECORDS, { search: 'heat' });
  assert.ok(res.every((r) => r.subject.toLowerCase().includes('heat')));
  assert.equal(res.length, 2); // r1 and r3 have "Heat Transfer"
});

test('search: by course code', () => {
  const res = adminFilter(RECORDS, { search: 'ME201' });
  assert.ok(res.length >= 2); // r2 and r5 have ME201
  assert.ok(res.every((r) => r.courseCode === 'ME201'));
});

test('search: by description / title text', () => {
  const res = adminFilter(RECORDS, { search: 'exam preparation' });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'r4');
});

test('search: partial match works', () => {
  const res = adminFilter(RECORDS, { search: 'therm' });
  assert.ok(res.length >= 2); // thermodynamics (r2, r5)
});

test('search: handles extra spaces and case differences', () => {
  const res1 = adminFilter(RECORDS, { search: '  FLUID  ' });
  assert.equal(res1.length, 1);
  assert.equal(res1[0].id, 'r4');
});

test('search: empty query returns all records', () => {
  assert.equal(adminFilter(RECORDS, { search: '' }).length, RECORDS.length);
  assert.equal(adminFilter(RECORDS, { search: '   ' }).length, RECORDS.length);
});

test('search: no matches returns empty array', () => {
  assert.equal(adminFilter(RECORDS, { search: 'nonexistent subject xyz' }).length, 0);
});

// ═════════════════════════════════════════════════════════════════════════════════
// 2. Subject Filter
// ═════════════════════════════════════════════════════════════════════════════════
test('subjectsOf: derives unique, sorted subjects from records (case-insensitive dedup)', () => {
  const subjects = c.subjectsOf(RECORDS);
  assert.ok(subjects.length >= 4); // Dynamics, Fluid Mechanics, Heat Transfer, Statics, Thermodynamics (or thermodynamics)
  // No duplicates for "thermodynamics" vs "Thermodynamics"
  const lower = subjects.map((s) => s.toLowerCase());
  assert.equal(lower.filter((s) => s === 'thermodynamics').length, 1);
  // Sorted alphabetically
  for (let i = 1; i < subjects.length; i++) {
    assert.ok(subjects[i - 1].localeCompare(subjects[i]) <= 0, `${subjects[i-1]} should be before ${subjects[i]}`);
  }
});

test('subject filter: selecting a subject shows only matching records', () => {
  const res = adminFilter(RECORDS, { subject: 'Heat Transfer' });
  assert.ok(res.length >= 2);
  assert.ok(res.every((r) => r.subject.toLowerCase() === 'heat transfer'));
});

test('subject filter: case-insensitive comparison', () => {
  const res = adminFilter(RECORDS, { subject: 'THERMODYNAMICS' });
  assert.ok(res.length >= 2);
  assert.ok(res.every((r) => r.subject.toLowerCase() === 'thermodynamics'));
});

test('subject filter: "all" returns everything', () => {
  assert.equal(adminFilter(RECORDS, { subject: 'all' }).length, RECORDS.length);
});

// ═════════════════════════════════════════════════════════════════════════════════
// 3. Type Filter
// ═════════════════════════════════════════════════════════════════════════════════
test('type filter: every canonical type is recognized', () => {
  for (const t of c.TYPES) {
    // At least verify filtering by each type doesn't crash and returns the right subset
    const res = adminFilter(RECORDS, { type: t });
    assert.ok(res.every((r) => r.type === t), `Type filter for "${t}" returned records with wrong type`);
  }
});

test('type filter: Assignment returns only Assignments', () => {
  const res = adminFilter(RECORDS, { type: 'Assignment' });
  assert.ok(res.length >= 1);
  assert.ok(res.every((r) => r.type === 'Assignment'));
});

test('type filter: M Project returns r3', () => {
  const res = adminFilter(RECORDS, { type: 'M Project' });
  assert.ok(res.some((r) => r.id === 'r3'));
  assert.ok(res.every((r) => r.type === 'M Project'));
});

test('type filter: "all" returns everything', () => {
  assert.equal(adminFilter(RECORDS, { type: 'all' }).length, RECORDS.length);
});

// ═════════════════════════════════════════════════════════════════════════════════
// 4. Status Filter
// ═════════════════════════════════════════════════════════════════════════════════
test('status filter: published only', () => {
  const res = adminFilter(RECORDS, { status: 'published' });
  assert.ok(res.every((r) => r.published === true));
  assert.ok(res.length > 0);
});

test('status filter: draft only', () => {
  const res = adminFilter(RECORDS, { status: 'draft' });
  assert.ok(res.every((r) => r.published === false));
  assert.ok(res.length >= 1);
  assert.ok(res.some((r) => r.id === 'r3')); // r3 is unpublished
});

test('status filter: upcoming — only records whose deadline is in the future', () => {
  const res = adminFilter(RECORDS, { status: 'upcoming' });
  assert.ok(res.every((r) => c.statusOf(r, now) === 'upcoming'));
});

test('status filter: overdue — deadline passed, no closesAt or closesAt not reached yet', () => {
  const res = adminFilter(RECORDS, { status: 'overdue' });
  assert.ok(res.every((r) => c.statusOf(r, now) === 'overdue'));
  // r4 has deadline in the past but no closesAt → overdue (not closed)
  assert.ok(res.some((r) => r.id === 'r4'));
});

test('status filter: past (closed) — closesAt has passed', () => {
  const res = adminFilter(RECORDS, { status: 'past' });
  assert.ok(res.every((r) => c.statusOf(r, now) === 'past'));
  // r3 and r7 have closesAt in the past → closed
  assert.ok(res.some((r) => r.id === 'r3') || res.some((r) => r.id === 'r7'));
});

test('status filter: "all" returns everything', () => {
  assert.equal(adminFilter(RECORDS, { status: 'all' }).length, RECORDS.length);
});

// ═════════════════════════════════════════════════════════════════════════════════
// 5. Sorting
// ═════════════════════════════════════════════════════════════════════════════════
test('sort: deadline ascending', () => {
  const res = adminFilter(RECORDS, { sort: 'deadline-asc' });
  for (let i = 1; i < res.length; i++) {
    assert.ok((res[i - 1].deadline || 0) <= (res[i].deadline || 0), `${res[i-1].id} should be before ${res[i].id}`);
  }
});

test('sort: deadline descending', () => {
  const res = adminFilter(RECORDS, { sort: 'deadline-desc' });
  for (let i = 1; i < res.length; i++) {
    assert.ok((res[i - 1].deadline || 0) >= (res[i].deadline || 0), `${res[i-1].id} should be before ${res[i].id}`);
  }
});

test('sort: newest first (by createdAt)', () => {
  const res = adminFilter(RECORDS, { sort: 'newest' });
  for (let i = 1; i < res.length; i++) {
    assert.ok((res[i - 1].createdAt || 0) >= (res[i].createdAt || 0), `${res[i-1].id} (created ${res[i-1].createdAt}) should be before ${res[i].id} (created ${res[i].createdAt})`);
  }
});

test('sort: subject A-Z', () => {
  const res = adminFilter(RECORDS, { sort: 'subject' });
  for (let i = 1; i < res.length; i++) {
    const cmp = (res[i - 1].subject || '').localeCompare(res[i].subject || '');
    assert.ok(cmp <= 0 || (cmp === 0 && (res[i - 1].deadline || 0) <= (res[i].deadline || 0)),
      `${res[i-1].subject} (${res[i-1].id}) should be before ${res[i].subject} (${res[i].id})`);
  }
});

test('sort: smart — upcoming first, then overdue, then past', () => {
  const res = adminFilter(RECORDS, { sort: 'smart' });
  const rank = { upcoming: 0, overdue: 1, past: 2 };
  for (let i = 1; i < res.length; i++) {
    const sa = rank[c.statusOf(res[i - 1], now)], sb = rank[c.statusOf(res[i], now)];
    assert.ok(sa <= sb, `${res[i-1].id} (${c.statusOf(res[i-1], now)}) should be before ${res[i].id} (${c.statusOf(res[i], now)})`);
  }
});

test('sort: handles missing/null createdAt and deadline safely', () => {
  const data = [
    rec('x1', { deadline: FAR_FUTURE, createdAt: null }),
    rec('x2', { deadline: null, createdAt: Date.now() }),
    rec('x3', { deadline: FAR_FUTURE + D, createdAt: Date.now() - D }),
  ];
  // Should not throw
  adminFilter(data, { sort: 'newest' });
  adminFilter(data, { sort: 'deadline-asc' });
  adminFilter(data, { sort: 'subject' });
  adminFilter(data, { sort: 'smart' });
});

// ═════════════════════════════════════════════════════════════════════════════════
// 6. Combined Filters
// ═════════════════════════════════════════════════════════════════════════════════
test('combined: search + subject + type', () => {
  const res = adminFilter(RECORDS, { search: 'heat', subject: 'Heat Transfer', type: 'Assignment' });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'r1');
});

test('combined: search + published + sort', () => {
  const res = adminFilter(RECORDS, { search: 'ME', status: 'published', sort: 'deadline-asc' });
  assert.ok(res.every((r) => r.published));
  assert.ok(res.every((r) => c.searchMatches(r, 'ME')));
  for (let i = 1; i < res.length; i++) {
    assert.ok((res[i - 1].deadline || 0) <= (res[i].deadline || 0));
  }
});

test('combined: type + status + sort', () => {
  const res = adminFilter(RECORDS, { type: 'Quiz', status: 'upcoming', sort: 'deadline-desc' });
  assert.ok(res.every((r) => r.type === 'Quiz'));
  assert.ok(res.every((r) => c.statusOf(r, now) === 'upcoming'));
});

test('combined: changing one filter preserves others', () => {
  // First filter: search + type
  const f1 = { search: 'heat', type: 'Assignment', subject: 'all', status: 'all', sort: 'smart' };
  const res1 = adminFilter(RECORDS, f1);
  assert.equal(res1.length, 1);
  // Change type to 'all', keep search
  const f2 = { ...f1, type: 'all' };
  const res2 = adminFilter(RECORDS, f2);
  assert.ok(res2.length > res1.length); // should get Heat Transfer records of all types
  assert.ok(res2.every((r) => c.searchMatches(r, 'heat')));
});

test('combined: all filters set returns correct intersection', () => {
  const res = adminFilter(RECORDS, {
    search: 'ME301',
    subject: 'Heat Transfer',
    type: 'M Project',
    status: 'draft',
    sort: 'deadline-asc'
  });
  // Only r3 matches all criteria
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'r3');
});

test('combined: no matches shows empty result', () => {
  const res = adminFilter(RECORDS, { subject: 'Heat Transfer', type: 'Midterm' });
  assert.equal(res.length, 0); // No Heat Transfer Midterms exist
});

// ═════════════════════════════════════════════════════════════════════════════════
// 7. closesAt Optional — Validation
// ═════════════════════════════════════════════════════════════════════════════════
const goodForm = (over = {}) => ({
  subject: 'Heat Transfer', type: 'Assignment', courseCode: '', description: '', published: true,
  deadline: '2026-11-01T23:59', closesAt: '', attachments: [], ...over
});

test('closesAt: empty closesAt passes validation (optional)', () => {
  const res = c.validateSubmission(goodForm({ closesAt: '' }));
  assert.equal(res.ok, true, 'Empty closesAt should pass');
  assert.equal(res.value.closesAt, null, 'closesAt should be null when empty');
});

test('closesAt: missing closesAt passes validation', () => {
  const { closesAt, ...noCloses } = goodForm();
  const res = c.validateSubmission({ ...noCloses, closesAt: '' });
  assert.equal(res.ok, true);
});

test('closesAt: valid closesAt >= deadline passes', () => {
  const res = c.validateSubmission(goodForm({ closesAt: '2026-11-02T01:00' }));
  assert.equal(res.ok, true);
  assert.ok(res.value.closesAt != null);
  assert.ok(res.value.closesAt >= res.value.deadline);
});

test('closesAt: closesAt earlier than deadline fails', () => {
  const res = c.validateSubmission(goodForm({ closesAt: '2026-11-01T10:00' }));
  assert.equal(res.ok, false);
  assert.ok(res.errors.closesAt);
});

test('closesAt: no closesAt error when toggle is off (empty string)', () => {
  const res = c.validateSubmission(goodForm({ closesAt: '' }));
  assert.equal(res.errors.closesAt, undefined, 'Should have no closesAt error');
});

test('closesAt: statusOf — deadline passed, no closesAt → overdue (not closed)', () => {
  const s = { deadline: PAST, closesAt: null };
  assert.equal(c.statusOf(s, now), 'overdue');
});

test('closesAt: statusOf — deadline passed, closesAt passed → past (closed)', () => {
  const s = { deadline: PAST, closesAt: PAST + H };
  assert.equal(c.statusOf(s, now), 'past');
});

test('closesAt: statusOf — deadline passed, closesAt not passed → overdue', () => {
  const s = { deadline: PAST, closesAt: FAR_FUTURE };
  assert.equal(c.statusOf(s, now), 'overdue');
});

test('closesAt: statusOf — deadline not passed → upcoming regardless of closesAt', () => {
  assert.equal(c.statusOf({ deadline: FAR_FUTURE, closesAt: null }, now), 'upcoming');
  assert.equal(c.statusOf({ deadline: FAR_FUTURE, closesAt: FAR_FUTURE + H }, now), 'upcoming');
});

// ═════════════════════════════════════════════════════════════════════════════════
// 8. searchMatches coverage
// ═════════════════════════════════════════════════════════════════════════════════
test('searchMatches: matches subject', () => {
  assert.ok(c.searchMatches(RECORDS[0], 'heat'));
  assert.ok(c.searchMatches(RECORDS[0], 'Heat Transfer'));
});

test('searchMatches: matches courseCode', () => {
  assert.ok(c.searchMatches(RECORDS[0], 'ME301'));
  assert.ok(c.searchMatches(RECORDS[0], 'me301'));
});

test('searchMatches: matches type', () => {
  assert.ok(c.searchMatches(RECORDS[0], 'assignment'));
  assert.ok(c.searchMatches(RECORDS[1], 'quiz'));
});

test('searchMatches: matches description', () => {
  assert.ok(c.searchMatches(RECORDS[0], 'chapter'));
  assert.ok(c.searchMatches(RECORDS[3], 'exam preparation'));
});

test('searchMatches: does not match unrelated text', () => {
  assert.ok(!c.searchMatches(RECORDS[0], 'fluid'));
  assert.ok(!c.searchMatches(RECORDS[0], 'nonexistent'));
});

test('searchMatches: empty/whitespace query matches everything', () => {
  assert.ok(c.searchMatches(RECORDS[0], ''));
  assert.ok(c.searchMatches(RECORDS[0], '   '));
  assert.ok(c.searchMatches(RECORDS[0], null));
  assert.ok(c.searchMatches(RECORDS[0], undefined));
});

// ═════════════════════════════════════════════════════════════════════════════════
// 9. Filters still work after adding a new record (data mutation safety)
// ═════════════════════════════════════════════════════════════════════════════════
test('filtering does not modify or remove original records', () => {
  const original = [...RECORDS];
  const originalLength = RECORDS.length;

  // Run various filters
  adminFilter(RECORDS, { subject: 'Heat Transfer' });
  adminFilter(RECORDS, { type: 'Quiz', status: 'upcoming', search: 'ME' });
  adminFilter(RECORDS, { sort: 'newest' });

  // Original array unchanged
  assert.equal(RECORDS.length, originalLength);
  for (let i = 0; i < RECORDS.length; i++) {
    assert.equal(RECORDS[i].id, original[i].id);
    assert.equal(RECORDS[i].subject, original[i].subject);
  }
});

test('adding a new record and re-filtering includes it', () => {
  const extended = [...RECORDS, rec('r8', { subject: 'Control Systems', type: 'M Project', courseCode: 'ME401' })];
  const res = adminFilter(extended, { subject: 'Control Systems' });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'r8');
  // Original subjects should now include Control Systems
  const subjects = c.subjectsOf(extended);
  assert.ok(subjects.some((s) => s === 'Control Systems'));
});

// ═════════════════════════════════════════════════════════════════════════════════
// 10. Reset individual filter
// ═════════════════════════════════════════════════════════════════════════════════
test('resetting subject to "all" removes only that filter', () => {
  const withSubj = adminFilter(RECORDS, { subject: 'Heat Transfer', type: 'Assignment' });
  const reset = adminFilter(RECORDS, { subject: 'all', type: 'Assignment' });
  assert.ok(reset.length >= withSubj.length);
  assert.ok(reset.every((r) => r.type === 'Assignment'));
});

test('clearing search preserves other filters', () => {
  const withSearch = adminFilter(RECORDS, { search: 'heat', type: 'Assignment' });
  const cleared = adminFilter(RECORDS, { search: '', type: 'Assignment' });
  assert.ok(cleared.length >= withSearch.length);
  assert.ok(cleared.every((r) => r.type === 'Assignment'));
});
