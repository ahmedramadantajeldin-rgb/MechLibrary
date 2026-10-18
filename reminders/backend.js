/* Mech Reminders — backend wrapper (Firebase Authentication + Cloud Firestore).
 * The SDK is loaded only when the site is configured, from Google's official CDN, pinned to one version.
 * All real protection lives in firestore.rules; nothing here is trusted by the server. */

const SDK_VERSION = '10.14.1';
const SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;
const COLLECTION = 'submissions';
const ADMINS = 'admins';                                             // central admin list: one document per e-mail (id = lower-case e-mail)

export async function createBackend(config) {
  const [{ initializeApp, getApps, getApp }, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js')
  ]);
  const app = getApps().length ? getApp() : initializeApp(config);     // never initialize the default app twice
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const col = F.collection(db, COLLECTION);
  const ref = (id) => F.doc(db, COLLECTION, id);
  const adminRef = (email) => F.doc(db, ADMINS, String(email).trim().toLowerCase());

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
  const toAdmin = (d) => {
    const x = d.data();
    return { email: String(x.email || d.id).toLowerCase(), active: x.active === true, addedBy: x.addedBy || '', createdAt: ms(x.createdAt), revokedAt: ms(x.revokedAt) };
  };
  const newAdminDoc = (email, ownerEmail) => ({
    email, active: true, addedBy: ownerEmail, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp()
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
    remove: (id) => F.deleteDoc(ref(id)),

    /* ---- administrator access (document admins/{e-mail}) ----
     * watchSelfAdmin: ANY signed-in account may read ONLY its own admin document; it fires again the moment the
     *   owner grants, revokes or removes access, which is how an open session notices a change right away.
     * The functions below it are owner-only; firestore.rules rejects them for everyone else. */
    watchSelfAdmin: (email, ok, err) => F.onSnapshot(adminRef(email),
      (snap) => ok(snap.exists() ? { active: snap.data().active === true } : null), err),

    watchAdmins: (ok, err) => F.onSnapshot(F.collection(db, ADMINS), (snap) => ok(snap.docs.map(toAdmin)), err),
    addAdmin: (email, ownerEmail) => F.setDoc(adminRef(email), newAdminDoc(String(email).trim().toLowerCase(), ownerEmail)),
    addAdmins: (emails, ownerEmail) => {                              // all-or-nothing (used once to import the previous administrators)
      const batch = F.writeBatch(db);
      for (const e of emails) { const id = String(e).trim().toLowerCase(); batch.set(adminRef(id), newAdminDoc(id, ownerEmail)); }
      return batch.commit();
    },
    revokeAdmin: (email, ownerEmail) => F.updateDoc(adminRef(email),
      { active: false, updatedAt: F.serverTimestamp(), revokedAt: F.serverTimestamp(), revokedBy: ownerEmail }),
    restoreAdmin: (email) => F.updateDoc(adminRef(email),
      { active: true, updatedAt: F.serverTimestamp(), revokedAt: F.deleteField(), revokedBy: F.deleteField() }),
    removeAdmin: (email) => F.deleteDoc(adminRef(email))
  };
}
