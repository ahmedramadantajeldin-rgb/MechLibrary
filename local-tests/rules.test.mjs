// Firestore security-rules tests — run against the Firebase Local Emulator.
// STATUS: written but NOT executed by the author (no network / emulator available in their environment). Run them yourself:
//
//   npm i -D @firebase/rules-unit-testing firebase
//   npx firebase-tools emulators:exec --only firestore --project demo-mech "node --test local-tests/rules.test.mjs"
//
// (run from the repository root; firestore.rules is read from there)
import test, { before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, query, where, setDoc, addDoc, updateDoc, deleteDoc, Timestamp, serverTimestamp } from 'firebase/firestore';

const ADMIN1 = 'ahmedramadantajeldin@gmail.com', ADMIN2 = 'ahmedyasserr219@gmail.com';
let env;
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-mech', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
after(async () => { await env.cleanup(); });

const T = (ms) => Timestamp.fromMillis(ms);
const valid = (over = {}) => ({
  subject: 'Heat Transfer', type: 'Quiz', courseCode: '', description: '',
  deadline: T(2e12), closesAt: T(2e12 + 3600e3), attachments: [{ title: 'Sheet', url: 'https://example.com/a.pdf', description: '' }],
  published: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over
});
const db = (email, verified = true) => env.authenticatedContext('u-' + email, { email, email_verified: verified }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'submissions/pub'), { ...valid(), createdAt: T(1), updatedAt: T(1) });
    await setDoc(doc(d, 'submissions/draft'), { ...valid({ published: false }), createdAt: T(1), updatedAt: T(1) });
  });
});

test('public: can read published only', async () => {
  const d = anon();
  await assertSucceeds(getDoc(doc(d, 'submissions/pub')));
  await assertFails(getDoc(doc(d, 'submissions/draft')));
  await assertSucceeds(getDocs(query(collection(d, 'submissions'), where('published', '==', true))));
  await assertFails(getDocs(collection(d, 'submissions')));               // unfiltered list would expose drafts
});

test('public and unrelated accounts: every write rejected', async () => {
  for (const d of [anon(), db('someone.else@gmail.com')]) {
    await assertFails(addDoc(collection(d, 'submissions'), valid()));
    await assertFails(updateDoc(doc(d, 'submissions/pub'), { subject: 'x', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(d, 'submissions/pub')));
    await assertFails(getDoc(doc(d, 'submissions/draft')));
  }
});

test('allow-listed email WITHOUT verified identity is not an admin', async () => {
  await assertFails(addDoc(collection(db(ADMIN1, false), 'submissions'), valid()));
});

test('both administrators can read everything and create / update / delete', async () => {
  for (const email of [ADMIN1, ADMIN2, ADMIN2.toUpperCase()]) {
    const d = db(email);
    await assertSucceeds(getDocs(collection(d, 'submissions')));
    const ref = await assertSucceeds(addDoc(collection(d, 'submissions'), valid()));
    await assertSucceeds(updateDoc(doc(d, 'submissions/' + ref.id), { published: false, updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(doc(d, 'submissions/' + ref.id)));
  }
});

test('admin writes are validated server-side', async () => {
  const col = collection(db(ADMIN1), 'submissions');
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
