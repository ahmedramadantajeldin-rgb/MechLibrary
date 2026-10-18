// Firestore security-rules tests for Mech Reminders (dynamic administrator list).
//
// ── Run against the REAL Firebase Emulator (authoritative; needs internet once, to download the emulator) ──
//   npm i -D @firebase/rules-unit-testing firebase firebase-tools
//   npx firebase emulators:exec --only firestore --project demo-mech "node --test local-tests/rules.test.mjs"
//   (run from the repository root; firestore.rules is read from there)
//
// ── Run OFFLINE against the project's own model of the rules language (no emulator, no network) ──
//   RULES_BACKEND=offline node --test local-tests/rules.test.mjs
//   The model (local-tests/rules-offline/) is NOT Google's engine. It catches logic mistakes; it cannot prove real behaviour.
//
// The numbered scenarios in the test names (S1 … S9) are the nine acceptance scenarios requested for the admin system.
import test, { before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';

const OFFLINE = process.env.RULES_BACKEND === 'offline';
const RUT = OFFLINE ? await import('./rules-offline/sdk-shim.mjs') : await import('@firebase/rules-unit-testing');
const FS = OFFLINE ? RUT : await import('firebase/firestore');
const { initializeTestEnvironment, assertFails, assertSucceeds } = RUT;
const { doc, getDoc, getDocs, collection, query, where, setDoc, addDoc, updateDoc, deleteDoc, deleteField, writeBatch, Timestamp, serverTimestamp } = FS;

const OWNER = 'ahmedramadantajeldin@gmail.com';
const PREVIOUS = ['ahmedyasserr219@gmail.com', 'mohamed.ibrahim200600@gmail.com', 'ahmedtageldien83@gmail.com'];
const [ADMIN_A, ADMIN_B, ADMIN_C] = PREVIOUS;
const NEWBIE = 'new.admin@example.com';
const STRANGER = 'someone.else@gmail.com';

let env;
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-mech', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
after(async () => { await env.cleanup(); });

const T = (ms) => Timestamp.fromMillis(ms);
const valid = (over = {}) => ({
  subject: 'Heat Transfer', type: 'Quiz', courseCode: '', description: '',
  deadline: T(2e12), closesAt: T(2e12 + 3600e3), attachments: [{ title: 'Sheet', url: 'https://example.com/a.pdf', description: '' }],
  published: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over
});
const adminDoc = (email, over = {}) => ({ email, active: true, addedBy: OWNER, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over });
const db = (email, verified = true) => env.authenticatedContext('u-' + email, { email, email_verified: verified }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const A = (d, email) => doc(d, 'admins/' + email);
const S = (d, id) => doc(d, 'submissions/' + id);

const revoke = (d, email) => updateDoc(A(d, email), { active: false, updatedAt: serverTimestamp(), revokedAt: serverTimestamp(), revokedBy: OWNER });
const restore = (d, email) => updateDoc(A(d, email), { active: true, updatedAt: serverTimestamp(), revokedAt: deleteField(), revokedBy: deleteField() });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'submissions/pub'), { ...valid(), createdAt: T(1), updatedAt: T(1) });
    await setDoc(doc(d, 'submissions/draft'), { ...valid({ published: false }), createdAt: T(1), updatedAt: T(1) });
    for (const e of PREVIOUS) await setDoc(doc(d, 'admins/' + e), { email: e, active: true, addedBy: OWNER, createdAt: T(1), updatedAt: T(1) });   // the migrated administrators
  });
});

/* ======================================================================= no static e-mail lists */
test('S8  no administrator list is written in the rules: the owner is the only e-mail address in firestore.rules', () => {
  const src = readFileSync('firestore.rules', 'utf8').replace(/\/\/.*$/gm, '');
  const found = [...new Set(src.match(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])];
  assert_equal(found, [OWNER]);
});
function assert_equal(a, b) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`expected ${y} but got ${x}`); }

/* ======================================================================= public data (unchanged policy) */
test('S7  public: can read published only; drafts and unfiltered lists are refused', async () => {
  const d = anon();
  await assertSucceeds(getDoc(S(d, 'pub')));
  await assertFails(getDoc(S(d, 'draft')));
  await assertSucceeds(getDocs(query(collection(d, 'submissions'), where('published', '==', true))));
  await assertFails(getDocs(collection(d, 'submissions')));               // unfiltered list would expose drafts
});

test('S6  anonymous, strangers and unverified accounts: every write is rejected and drafts stay private', async () => {
  for (const d of [anon(), db(STRANGER), db(OWNER, false), db(ADMIN_A, false)]) {
    await assertFails(addDoc(collection(d, 'submissions'), valid()));
    await assertFails(updateDoc(S(d, 'pub'), { subject: 'x', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(S(d, 'pub')));
    await assertFails(getDoc(S(d, 'draft')));
  }
});

/* ======================================================================= S1 / S2 / S8: owner adds an admin, no redeploy */
test('S1  owner can add a new administrator from the site', async () => {
  const o = db(OWNER);
  await assertSucceeds(setDoc(A(o, NEWBIE), adminDoc(NEWBIE)));
  await assertSucceeds(getDoc(A(o, NEWBIE)));
});

test('S1  owner can add several administrators at once (import of the previous list uses a batch)', async () => {
  const o = db(OWNER), batch = writeBatch(o);
  for (const e of ['a1@example.com', 'a2@example.com', 'a3@example.com']) batch.set(A(o, e), adminDoc(e));
  await assertSucceeds(batch.commit());
});

test('S1  owner e-mail matching is case-insensitive, and the owner token is accepted in any letter case', async () => {
  await assertSucceeds(setDoc(A(db(OWNER.toUpperCase()), NEWBIE), adminDoc(NEWBIE)));
});

test('S1  malformed administrator documents are refused even for the owner', async () => {
  const o = db(OWNER);
  await assertFails(setDoc(A(o, NEWBIE), adminDoc(NEWBIE, { active: false })));                       // must be created active
  await assertFails(setDoc(A(o, NEWBIE), adminDoc(NEWBIE, { extra: 1 })));                            // unknown field
  await assertFails(setDoc(A(o, NEWBIE), adminDoc('other@example.com')));                             // email must equal the document id
  await assertFails(setDoc(A(o, NEWBIE), adminDoc(NEWBIE, { addedBy: STRANGER })));                   // audit field must be the owner
  await assertFails(setDoc(A(o, NEWBIE), adminDoc(NEWBIE, { createdAt: T(5) })));                     // server time only
  await assertFails(setDoc(A(o, NEWBIE), adminDoc(NEWBIE, { updatedAt: T(5) })));
  await assertFails(setDoc(A(o, NEWBIE), adminDoc(NEWBIE, { revokedAt: serverTimestamp() })));        // revoke fields only while revoked
  await assertFails(setDoc(A(o, 'Mixed.Case@Example.com'), adminDoc('Mixed.Case@Example.com')));     // ids are lower-case
  await assertFails(setDoc(A(o, 'not-an-email'), adminDoc('not-an-email')));
  await assertFails(setDoc(A(o, 'a b@example.com'), adminDoc('a b@example.com')));
  await assertFails(setDoc(A(o, NEWBIE), { email: NEWBIE, active: 'yes', addedBy: OWNER, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(setDoc(A(o, NEWBIE), { email: NEWBIE, active: true, addedBy: OWNER, createdAt: serverTimestamp() }));   // missing updatedAt
});

test('S2/S8  a newly added administrator can manage reminders at once — no change to files, rules or deployment', async () => {
  const n = db(NEWBIE);
  await assertFails(addDoc(collection(n, 'submissions'), valid()));                                   // not yet listed
  await assertSucceeds(setDoc(A(db(OWNER), NEWBIE), adminDoc(NEWBIE)));                              // ← the only thing that changes: data
  await assertSucceeds(getDocs(collection(n, 'submissions')));                                        // sees drafts
  const ref = await assertSucceeds(addDoc(collection(n, 'submissions'), valid()));
  await assertSucceeds(updateDoc(S(n, ref.id), { published: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(S(n, ref.id)));
});

test('S2  every migrated administrator and the owner can read everything and create / update / delete reminders', async () => {
  for (const email of [OWNER, ...PREVIOUS, ADMIN_B.toUpperCase()]) {
    const d = db(email);
    await assertSucceeds(getDocs(collection(d, 'submissions')));
    const ref = await assertSucceeds(addDoc(collection(d, 'submissions'), valid()));
    await assertSucceeds(updateDoc(S(d, ref.id), { published: false, updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(S(d, ref.id)));
  }
});

test('S2  administrator writes are still validated server-side (unchanged rules)', async () => {
  const col = collection(db(ADMIN_A), 'submissions');
  for (const type of ['Assignment', 'Quiz', 'Midterm', 'M Assignment', 'M Quiz', 'M Midterm', 'M Project']) await assertSucceeds(addDoc(col, valid({ type })));
  await assertFails(addDoc(col, valid({ type: 'Exam' })));
  await assertFails(addDoc(col, valid({ subject: '' })));
  await assertFails(addDoc(col, valid({ closesAt: T(2e12 - 1000) })));                                  // closes before the deadline
  await assertFails(addDoc(col, valid({ attachments: [{ title: 'x', url: 'http://insecure.example/a.pdf', description: '' }] })));
  await assertFails(addDoc(col, valid({ attachments: [{ title: 'x', url: 'javascript:alert(1)', description: '' }] })));
  await assertFails(addDoc(col, valid({ attachments: Array.from({ length: 11 }, (_, i) => ({ title: 't' + i, url: 'https://e.com/' + i, description: '' })) })));
  await assertFails(addDoc(col, valid({ unexpectedField: 1 })));
  await assertFails(addDoc(col, valid({ updatedAt: T(5) })));                                            // must be the server time
  await assertSucceeds(addDoc(col, valid({ attachments: Array.from({ length: 10 }, (_, i) => ({ title: 't' + i, url: 'https://e.com/' + i, description: '' })) })));
});

/* ======================================================================= S3: a regular admin cannot manage admins */
test('S3  a regular administrator cannot add another administrator or promote anyone', async () => {
  const a = db(ADMIN_A);
  await assertFails(setDoc(A(a, NEWBIE), adminDoc(NEWBIE)));
  await assertFails(setDoc(A(a, NEWBIE), adminDoc(NEWBIE, { addedBy: ADMIN_A })));
  const batch = writeBatch(a); batch.set(A(a, NEWBIE), adminDoc(NEWBIE));
  await assertFails(batch.commit());
});

test('S3  a regular administrator cannot promote or re-enable themselves, nor touch anyone else\'s entry', async () => {
  const a = db(ADMIN_A);
  await assertFails(updateDoc(A(a, ADMIN_A), { active: true, updatedAt: serverTimestamp() }));          // even a no-op "promotion"
  await assertFails(updateDoc(A(a, ADMIN_A), { addedBy: ADMIN_A, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(A(a, ADMIN_A), adminDoc(ADMIN_A)));
  await assertFails(updateDoc(A(a, ADMIN_B), { active: false, updatedAt: serverTimestamp(), revokedAt: serverTimestamp(), revokedBy: ADMIN_A }));
  await assertFails(deleteDoc(A(a, ADMIN_B)));
  await assertFails(deleteDoc(A(a, ADMIN_A)));
  await assertFails(setDoc(A(a, OWNER), adminDoc(OWNER)));                                              // cannot make an "owner" entry
  await assertFails(setDoc(A(a, OWNER), { email: OWNER, role: 'owner', active: true, addedBy: ADMIN_A, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test('S3  a regular administrator cannot list the administrators; they can only read their own entry', async () => {
  const a = db(ADMIN_A);
  await assertFails(getDocs(collection(a, 'admins')));
  await assertFails(getDoc(A(a, ADMIN_B)));
  await assertSucceeds(getDoc(A(a, ADMIN_A)));                                                          // the site uses this to notice revocation
});

test('S3/S6  a stranger cannot create their own entry, and can only read their own (empty) entry', async () => {
  const s = db(STRANGER);
  await assertFails(setDoc(A(s, STRANGER), adminDoc(STRANGER)));
  await assertFails(setDoc(A(s, STRANGER), adminDoc(STRANGER, { addedBy: STRANGER })));
  await assertFails(getDocs(collection(s, 'admins')));
  await assertFails(getDoc(A(s, ADMIN_A)));
  const own = await assertSucceeds(getDoc(A(s, STRANGER)));
  if (own.exists()) throw new Error('a stranger must not have an administrator entry');
  await assertFails(getDoc(A(anon(), ADMIN_A)));
  await assertFails(setDoc(A(anon(), STRANGER), adminDoc(STRANGER)));
});

test('S3  the unverified owner e-mail and an unverified listed administrator get nothing', async () => {
  await assertFails(setDoc(A(db(OWNER, false), NEWBIE), adminDoc(NEWBIE)));
  await assertFails(getDocs(collection(db(OWNER, false), 'admins')));
  await assertFails(getDoc(A(db(ADMIN_A, false), ADMIN_A)));
  await assertFails(addDoc(collection(db(ADMIN_A, false), 'submissions'), valid()));
});

/* ======================================================================= S4 / S5: revoke, restore, remove */
test('S4  the owner can read the list and revoke, restore and remove any administrator', async () => {
  const o = db(OWNER);
  const all = await assertSucceeds(getDocs(collection(o, 'admins')));
  if (all.docs.length !== 3) throw new Error('owner must see all 3 migrated administrators, saw ' + all.docs.length);
  await assertSucceeds(revoke(o, ADMIN_A));
  const revoked = (await getDoc(A(o, ADMIN_A))).data();
  if (revoked.active !== false || !revoked.revokedAt || revoked.revokedBy !== OWNER) throw new Error('revoked entry is incomplete');
  await assertSucceeds(restore(o, ADMIN_A));
  const back = (await getDoc(A(o, ADMIN_A))).data();
  if (back.active !== true || 'revokedAt' in back || 'revokedBy' in back) throw new Error('restored entry still carries revoke fields');
  await assertSucceeds(deleteDoc(A(o, ADMIN_B)));
  await assertSucceeds(deleteDoc(A(o, ADMIN_C)));
});

test('S4  revoke / restore must be well-formed, and e-mail, "added by" and creation time can never change', async () => {
  const o = db(OWNER);
  await assertFails(updateDoc(A(o, ADMIN_A), { active: false, updatedAt: serverTimestamp() }));                                       // revoked without who/when
  await assertFails(updateDoc(A(o, ADMIN_A), { active: false, updatedAt: serverTimestamp(), revokedAt: T(5), revokedBy: OWNER }));    // not server time
  await assertFails(updateDoc(A(o, ADMIN_A), { active: false, updatedAt: serverTimestamp(), revokedAt: serverTimestamp(), revokedBy: STRANGER }));
  await assertFails(updateDoc(A(o, ADMIN_A), { active: 'no', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(A(o, ADMIN_A), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));                        // creation time is immutable
  await assertFails(updateDoc(A(o, ADMIN_A), { addedBy: STRANGER, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(A(o, ADMIN_A), { email: STRANGER, updatedAt: serverTimestamp() }));                                     // e-mail must stay equal to the id
  await assertFails(updateDoc(A(o, ADMIN_A), { role: 'owner', updatedAt: serverTimestamp() }));                                       // no extra fields
  await assertFails(updateDoc(A(o, ADMIN_A), { updatedAt: T(5) }));
  await assertSucceeds(revoke(o, ADMIN_A));
  await assertFails(updateDoc(A(o, ADMIN_A), { active: true, updatedAt: serverTimestamp() }));                                        // restoring must clear the revoke fields
});

test('S5  a revoked account loses all write access at once — even in a session that is already open', async () => {
  const a = db(ADMIN_A);                                           // one open session (same token) used before and after the revocation
  const mine = await assertSucceeds(addDoc(collection(a, 'submissions'), valid()));
  await assertSucceeds(getDoc(S(a, 'draft')));
  await assertSucceeds(revoke(db(OWNER), ADMIN_A));
  await assertFails(addDoc(collection(a, 'submissions'), valid()));
  await assertFails(updateDoc(S(a, mine.id), { published: false, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(S(a, 'pub'), { published: false, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(S(a, mine.id)));
  await assertFails(getDoc(S(a, 'draft')));                        // drafts are private again
  await assertFails(getDocs(collection(a, 'submissions')));
  await assertSucceeds(getDocs(query(collection(a, 'submissions'), where('published', '==', true))));   // published data stays public
  const own = await assertSucceeds(getDoc(A(a, ADMIN_A)));          // …and the page can see that its own access ended
  if (own.data().active !== false) throw new Error('own entry should show active:false');
  await assertSucceeds(restore(db(OWNER), ADMIN_A));                // access returns the moment the owner restores it
  await assertSucceeds(addDoc(collection(a, 'submissions'), valid()));
});

test('S5  an administrator removed from the list loses write access at once', async () => {
  const b = db(ADMIN_B);
  await assertSucceeds(addDoc(collection(b, 'submissions'), valid()));
  await assertSucceeds(deleteDoc(A(db(OWNER), ADMIN_B)));
  await assertFails(addDoc(collection(b, 'submissions'), valid()));
  await assertFails(deleteDoc(S(b, 'pub')));
  await assertFails(getDoc(S(b, 'draft')));
});

test('S5  an administrator whose entry is malformed (no "active" flag) is not an administrator', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'admins/' + NEWBIE), { email: NEWBIE }); });
  await assertFails(addDoc(collection(db(NEWBIE), 'submissions'), valid()));
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'admins/' + NEWBIE), { email: NEWBIE, active: 'true' }); });
  await assertFails(addDoc(collection(db(NEWBIE), 'submissions'), valid()));
});

/* ======================================================================= S7: published data stays public */
test('S7  published reminders stay publicly readable after any change to the administrator list', async () => {
  const o = db(OWNER);
  await revoke(o, ADMIN_A); await deleteDoc(A(o, ADMIN_B)); await setDoc(A(o, NEWBIE), adminDoc(NEWBIE));
  const pub = query(collection(anon(), 'submissions'), where('published', '==', true));
  const snap = await assertSucceeds(getDocs(pub));
  if (snap.docs.length !== 1) throw new Error('expected exactly the 1 published record, got ' + snap.docs.length);
  await assertSucceeds(getDoc(S(anon(), 'pub')));
  await assertFails(getDoc(S(anon(), 'draft')));
});

/* ======================================================================= S9: the owner is untouchable */
test('S9  nobody — not even the owner — can create, change or delete an entry for the owner', async () => {
  for (const who of [db(OWNER), db(ADMIN_A), db(STRANGER), anon()]) {
    await assertFails(setDoc(A(who, OWNER), adminDoc(OWNER)));
    await assertFails(setDoc(A(who, OWNER), adminDoc(OWNER, { active: false, revokedAt: serverTimestamp(), revokedBy: OWNER })));   // "disable the owner"
    await assertFails(deleteDoc(A(who, OWNER)));
    await assertFails(updateDoc(A(who, OWNER), { active: false, updatedAt: serverTimestamp(), revokedAt: serverTimestamp(), revokedBy: OWNER }));
  }
  await env.withSecurityRulesDisabled(async (ctx) => {             // even if an owner entry were somehow planted, it cannot be edited or used to lock the owner out
    await setDoc(doc(ctx.firestore(), 'admins/' + OWNER), { email: OWNER, active: false, addedBy: OWNER, createdAt: T(1), updatedAt: T(1), revokedAt: T(1), revokedBy: OWNER });
  });
  const o = db(OWNER);
  await assertSucceeds(addDoc(collection(o, 'submissions'), valid()));                                 // still an administrator
  await assertSucceeds(getDocs(collection(o, 'admins')));                                              // still in charge of the list
  await assertSucceeds(setDoc(A(o, NEWBIE), adminDoc(NEWBIE)));
  await assertFails(deleteDoc(A(o, OWNER)));
});

test('S9  the owner keeps full control even when every other administrator has been deleted', async () => {
  const o = db(OWNER);
  for (const e of PREVIOUS) await assertSucceeds(deleteDoc(A(o, e)));
  const empty = await assertSucceeds(getDocs(collection(o, 'admins')));
  if (empty.docs.length !== 0) throw new Error('list should be empty');
  await assertSucceeds(addDoc(collection(o, 'submissions'), valid()));
  await assertSucceeds(setDoc(A(o, NEWBIE), adminDoc(NEWBIE)));
  await assertSucceeds(addDoc(collection(db(NEWBIE), 'submissions'), valid()));
});

test('S9  an administrator cannot lock the owner out or interfere with the list by any route', async () => {
  const a = db(ADMIN_A);
  await assertFails(deleteDoc(A(a, OWNER)));
  await assertFails(getDocs(collection(a, 'admins')));
  for (const e of PREVIOUS) await assertFails(deleteDoc(A(a, e)));
  await assertSucceeds(addDoc(collection(db(OWNER), 'submissions'), valid()));                        // owner unaffected
});

/* ======================================================================= everything else stays closed */
test('every other collection is closed to everybody, including the owner', async () => {
  for (const d of [anon(), db(STRANGER), db(ADMIN_A), db(OWNER)]) {
    await assertFails(setDoc(doc(d, 'settings/x'), { a: 1 }));
    await assertFails(getDoc(doc(d, 'settings/x')));
    await assertFails(setDoc(doc(d, 'admins/nested@example.com/sub/doc'), { a: 1 }));
  }
});
