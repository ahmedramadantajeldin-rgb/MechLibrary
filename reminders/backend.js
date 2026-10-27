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
      deadline: ms(x.deadline), closesAt: x.closesAt ? ms(x.closesAt) : null,
      attachments: Array.isArray(x.attachments) ? x.attachments : [],
      published: x.published === true,
      createdAt: ms(x.createdAt)
    };
  };
  const usable = (r) => r.deadline != null;                           // closesAt is now optional
  const watch = (q, ok, err) => F.onSnapshot(q, (snap) => ok(snap.docs.map(toRecord).filter(usable)), err);
  const toDoc = (v, isUpdate = false) => {
    const doc = {
      subject: v.subject, type: v.type, courseCode: v.courseCode, description: v.description,
      deadline: F.Timestamp.fromMillis(v.deadline),
      attachments: v.attachments, published: v.published
    };
    if (v.closesAt != null) doc.closesAt = F.Timestamp.fromMillis(v.closesAt);
    else if (isUpdate) doc.closesAt = F.deleteField();                // remove stale closing time
    return doc;
  };
  const toAdmin = (d) => {
    const x = d.data();
    return { email: String(x.email || d.id).toLowerCase(), active: x.active === true, canManage: x.canManageAdmins === true, addedBy: x.addedBy || '', createdAt: ms(x.createdAt), revokedAt: ms(x.revokedAt) };
  };
  // actor = the e-mail of whoever is adding (owner or manager); the rules require it to match the signed-in account.
  const newAdminDoc = (email, actor, canManage = false) => ({
    email, active: true, addedBy: actor, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp(),
    ...(canManage ? { canManageAdmins: true } : {})                  // only the owner may set this; the rules refuse it from anybody else
  });

  return {
    onAuth: (cb) => A.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid || '', email: u.email || '', verified: u.emailVerified === true, name: u.displayName || '' } : null)),
    signIn: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
    signOut: () => A.signOut(auth),

    watchPublished: (ok, err) => watch(F.query(col, F.where('published', '==', true)), ok, err),
    watchAll: (ok, err) => watch(col, ok, err),                       // admins only (enforced by firestore.rules)

    create: (v) => F.addDoc(col, { ...toDoc(v), createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() }),
    update: (id, v) => F.updateDoc(ref(id), { ...toDoc(v, true), updatedAt: F.serverTimestamp() }),
    setPublished: (id, published) => F.updateDoc(ref(id), { published, updatedAt: F.serverTimestamp() }),
    remove: (id) => F.deleteDoc(ref(id)),

    /* ---- administrator access (document admins/{e-mail}) ----
     * watchSelfAdmin: ANY signed-in account may read ONLY its own admin document; it fires again the moment the
     *   owner grants, revokes or removes access, which is how an open session notices a change right away.
     * The functions below it are for the owner and for managers (admins with canManageAdmins); firestore.rules
     *   rejects them for everyone else, and only the owner may touch owner / manager entries or the manager right. */
    watchSelfAdmin: (email, ok, err) => F.onSnapshot(adminRef(email),
      (snap) => ok(snap.exists() ? { active: snap.data().active === true, canManage: snap.data().canManageAdmins === true } : null), err),

    watchAdmins: (ok, err) => F.onSnapshot(F.collection(db, ADMINS), (snap) => ok(snap.docs.map(toAdmin)), err),
    addAdmin: (email, actor) => F.setDoc(adminRef(email), newAdminDoc(String(email).trim().toLowerCase(), actor)),
    addAdmins: (entries, actor) => {                                  // all-or-nothing (owner, once: import the previous administrators)
      const batch = F.writeBatch(db);
      for (const { email, canManage } of entries) { const id = String(email).trim().toLowerCase(); batch.set(adminRef(id), newAdminDoc(id, actor, canManage === true)); }
      return batch.commit();
    },
    setManager: (email, value) => F.updateDoc(adminRef(email), { canManageAdmins: value === true, updatedAt: F.serverTimestamp() }),   // owner only
    revokeAdmin: (email, actor) => F.updateDoc(adminRef(email),
      { active: false, updatedAt: F.serverTimestamp(), revokedAt: F.serverTimestamp(), revokedBy: actor }),
    restoreAdmin: (email) => F.updateDoc(adminRef(email),
      { active: true, updatedAt: F.serverTimestamp(), revokedAt: F.deleteField(), revokedBy: F.deleteField() }),
    removeAdmin: (email) => F.deleteDoc(adminRef(email)),

    /* ---- user preferences and personal tasks (keyed by Firebase UID, never e-mail) ---- */
    watchPreferences: (uid, ok, err) => F.onSnapshot(F.doc(db, 'userPreferences', uid),
      (snap) => ok(snap.exists() ? snap.data() : null), err),
    savePreferences: (uid, data) => F.setDoc(F.doc(db, 'userPreferences', uid),
      { ...data, updatedAt: F.serverTimestamp() }, { merge: true }),

    watchTasks: (uid, ok, err) => F.onSnapshot(F.collection(db, 'personalTasks', uid, 'tasks'),
      (snap) => ok(snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, title: x.title || '', subject: x.subject || '', datetime: ms(x.datetime),
          notes: x.notes || '', completed: x.completed === true,
          reminderLeads: Array.isArray(x.reminderLeads) ? x.reminderLeads : [], createdAt: ms(x.createdAt) };
      })), err),
    createTask: (uid, task) => F.addDoc(F.collection(db, 'personalTasks', uid, 'tasks'), {
      title: task.title || '', subject: task.subject || '', notes: task.notes || '',
      datetime: task.datetime ? F.Timestamp.fromMillis(task.datetime) : null,
      completed: false, reminderLeads: task.reminderLeads || [],
      createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp()
    }),
    updateTask: (uid, taskId, data) => {
      const u = { updatedAt: F.serverTimestamp() };
      if (data.title !== undefined) u.title = data.title;
      if (data.subject !== undefined) u.subject = data.subject;
      if (data.notes !== undefined) u.notes = data.notes;
      if (data.completed !== undefined) u.completed = data.completed === true;
      if (data.reminderLeads !== undefined) u.reminderLeads = data.reminderLeads;
      if (data.datetime !== undefined) u.datetime = data.datetime ? F.Timestamp.fromMillis(data.datetime) : null;
      return F.updateDoc(F.doc(db, 'personalTasks', uid, 'tasks', taskId), u);
    },
    deleteTask: (uid, taskId) => F.deleteDoc(F.doc(db, 'personalTasks', uid, 'tasks', taskId))
  };
}
