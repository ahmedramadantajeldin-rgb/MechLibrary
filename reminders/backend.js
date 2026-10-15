/* Mech Reminders — backend wrapper (Firebase Authentication + Cloud Firestore).
 * The SDK is loaded only when the site is configured, from Google's official CDN, pinned to one version.
 * All real protection lives in firestore.rules; nothing here is trusted by the server. */

const SDK_VERSION = '10.14.1';
const SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;
const COLLECTION = 'submissions';

export async function createBackend(config) {
  const [{ initializeApp, getApps, getApp }, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js')
  ]);
  const app = getApps().length ? getApp() : initializeApp(config);     // never initialize twice (duplicate-app error)
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const col = F.collection(db, COLLECTION);
  const ref = (id) => F.doc(db, COLLECTION, id);

  startAnalytics(app, config);                                          // optional; never awaited, never throws

  const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
  const toRecord = (d) => {
    const x = d.data();
    return {
      id: d.id,
      subject: String(x.subject || ''), type: x.type || '', courseCode: x.courseCode || '', description: x.description || '',
      deadline: ms(x.deadline), closesAt: ms(x.closesAt),
      attachments: Array.isArray(x.attachments) ? x.attachments : [],
      published: x.published === true
    };
  };
  const usable = (r) => r.deadline != null && r.closesAt != null;     // ignore malformed documents instead of crashing
  const watch = (q, ok, err) => F.onSnapshot(q, (snap) => ok(snap.docs.map(toRecord).filter(usable)), err);
  const toDoc = (v) => ({
    subject: v.subject, type: v.type, courseCode: v.courseCode, description: v.description,
    deadline: F.Timestamp.fromMillis(v.deadline), closesAt: F.Timestamp.fromMillis(v.closesAt),
    attachments: v.attachments, published: v.published
  });

  return {
    onAuth: (cb) => A.onAuthStateChanged(auth, (u) => cb(u ? { email: u.email || '', verified: u.emailVerified === true, name: u.displayName || '' } : null)),
    signIn: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
    signOut: () => A.signOut(auth),

    watchPublished: (ok, err) => watch(F.query(col, F.where('published', '==', true)), ok, err),
    watchAll: (ok, err) => watch(col, ok, err),                       // admins only (enforced by firestore.rules)

    create: (v) => F.addDoc(col, { ...toDoc(v), createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() }),
    update: (id, v) => F.updateDoc(ref(id), { ...toDoc(v), updatedAt: F.serverTimestamp() }),
    setPublished: (id, published) => F.updateDoc(ref(id), { published, updatedAt: F.serverTimestamp() }),
    remove: (id) => F.deleteDoc(ref(id))
  };
}

/* Analytics is optional: it is loaded in the background, only when the config has a measurementId and the browser
 * supports it. Any failure (blocked by an ad-blocker, offline, unsupported) is swallowed so the reminders page is unaffected. */
function startAnalytics(app, config) {
  if (!config.measurementId) return;
  import(SDK + 'firebase-analytics.js')
    .then((N) => N.isSupported().then((ok) => { if (ok) N.getAnalytics(app); }))
    .catch((e) => console.warn('Firebase Analytics is unavailable (reminders are not affected):', e && e.message ? e.message : e));
}
