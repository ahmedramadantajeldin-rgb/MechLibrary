// Offline stand-in for BOTH `@firebase/rules-unit-testing` and `firebase/firestore`, backed by rules-engine.mjs and an
// in-memory database. It lets local-tests/rules.test.mjs run unchanged without the Firebase Emulator
// (set RULES_BACKEND=offline). See the warning at the top of rules-engine.mjs: this is a model, not Google's engine.
import { readFileSync } from 'node:fs';
import { RulesEngine, Ts } from './rules-engine.mjs';

/* ---------- sentinels / values ---------- */
export const serverTimestamp = () => ({ __sentinel: 'serverTimestamp' });
export const deleteField = () => ({ __sentinel: 'deleteField' });
export const Timestamp = { fromMillis: (ms) => new Ts(ms), now: () => new Ts(Date.now()) };

const denied = () => Object.assign(new Error('PERMISSION_DENIED: Missing or insufficient permissions.'), { code: 'permission-denied' });
const notFound = () => Object.assign(new Error('NOT_FOUND'), { code: 'not-found' });
const clone = (v) => (v instanceof Ts ? new Ts(v.ms) : Array.isArray(v) ? v.map(clone) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);

/* ---------- in-memory database + rule enforcement ---------- */
class Db {
  constructor(rules) { this.engine = new RulesEngine(rules); this.docs = new Map(); this.seq = 0; }
  key(col, id) { return `${col}/${id}`; }
  read(col, id) { const d = this.docs.get(this.key(col, id)); return d ? { data: d } : null; }   // used by get()/exists() inside rules (never rule-checked)
  clear() { this.docs.clear(); }
}

const resolve = (value, now) => {                                    // replace serverTimestamp sentinels with request.time
  if (value && value.__sentinel === 'serverTimestamp') return new Ts(now);
  if (Array.isArray(value)) return value.map((x) => resolve(x, now));
  if (value instanceof Ts) return value;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, resolve(x, now)]));
  return value;
};

function check(h, op, segs, resource, incoming, now) {
  if (h.__disabled) return;
  const auth = h.__auth ? { uid: h.__auth.uid, token: { ...h.__auth.token } } : null;
  const ok = h.__db.engine.allowed({ op, segs, auth, resource, incoming, time: new Ts(now), db: h.__db });
  if (!ok) throw denied();
}

/* ---------- firebase/firestore surface ---------- */
export const doc = (h, ...path) => { const segs = path.join('/').split('/').filter(Boolean); return { kind: 'doc', h, segs, id: segs[segs.length - 1] }; };
export const collection = (h, ...path) => ({ kind: 'col', h, segs: path.join('/').split('/').filter(Boolean) });
export const where = (field, op, value) => ({ field, op, value });
export const query = (col, ...constraints) => ({ kind: 'query', col, constraints });

const snapOf = (ref, data) => ({ id: ref.segs[ref.segs.length - 1], ref, exists: () => data != null, data: () => (data == null ? undefined : clone(data)) });

export async function getDoc(ref) {
  const [c, id] = ref.segs, now = Date.now(), cur = ref.h.__db.read(c, id);
  check(ref.h, 'get', ref.segs, cur ? cur.data : null, null, now);
  return snapOf(ref, cur ? cur.data : null);
}

export async function getDocs(q) {
  const col = q.kind === 'col' ? q : q.col, cons = q.kind === 'col' ? [] : q.constraints, name = col.segs[0], now = Date.now();
  // Rules are not filters: the query's own constraints must be enough to satisfy the rule. Model the query by the strongest
  // document it can return: only the equality constraints are known about it.
  const synthetic = {}; for (const c of cons) if (c.op === '==') synthetic[c.field] = c.value;
  check(col.h, 'list', [name, '(query)'], synthetic, null, now);
  const rows = [...col.h.__db.docs.entries()].filter(([k]) => k.startsWith(name + '/'))
    .filter(([, d]) => cons.every((c) => c.op !== '==' || (d[c.field] instanceof Ts && c.value instanceof Ts ? d[c.field].ms === c.value.ms : d[c.field] === c.value)));
  return { docs: rows.map(([k, d]) => snapOf(doc(col.h, k), d)), size: rows.length, empty: rows.length === 0 };
}

function applyWrite(h, kind, segs, payload, now, db) {
  const [c, id] = segs, cur = db.read(c, id);
  if (kind === 'set') {
    const incoming = resolve(payload, now);
    check(h, cur ? 'update' : 'create', segs, cur ? cur.data : null, incoming, now);
    return () => db.docs.set(db.key(c, id), incoming);
  }
  if (kind === 'update') {
    const merged = cur ? clone(cur.data) : {};
    for (const [k, v] of Object.entries(payload)) { if (v && v.__sentinel === 'deleteField') delete merged[k]; else merged[k] = resolve(v, now); }
    check(h, 'update', segs, cur ? cur.data : null, merged, now);
    if (!cur) throw notFound();
    return () => db.docs.set(db.key(c, id), merged);
  }
  check(h, 'delete', segs, cur ? cur.data : null, null, now);
  return () => db.docs.delete(db.key(c, id));
}

export async function setDoc(ref, data) { applyWrite(ref.h, 'set', ref.segs, data, Date.now(), ref.h.__db)(); }
export async function updateDoc(ref, data) { applyWrite(ref.h, 'update', ref.segs, data, Date.now(), ref.h.__db)(); }
export async function deleteDoc(ref) { applyWrite(ref.h, 'delete', ref.segs, null, Date.now(), ref.h.__db)(); }
export async function addDoc(col, data) {
  const id = 'auto' + (++col.h.__db.seq), ref = doc(col.h, col.segs[0], id);
  await setDoc(ref, data); return ref;
}
export function writeBatch(h) {
  const ops = [];
  return {
    set: (ref, data) => { ops.push(['set', ref, data]); },
    update: (ref, data) => { ops.push(['update', ref, data]); },
    delete: (ref) => { ops.push(['delete', ref]); },
    commit: async () => { const now = Date.now(); const apply = ops.map(([k, ref, d]) => applyWrite(h, k, ref.segs, d, now, h.__db)); apply.forEach((f) => f()); }   // every write is checked first: all-or-nothing
  };
}

/* ---------- @firebase/rules-unit-testing surface ---------- */
export async function initializeTestEnvironment({ firestore }) {
  const db = new Db(firestore.rules);
  const ctx = (auth, disabled = false) => ({ firestore: () => ({ __db: db, __auth: auth, __disabled: disabled }) });
  return {
    authenticatedContext: (uid, token = {}) => ctx({ uid, token }),
    unauthenticatedContext: () => ctx(null),
    withSecurityRulesDisabled: async (fn) => { await fn(ctx(null, true)); },
    clearFirestore: async () => { db.clear(); },
    cleanup: async () => {}
  };
}
export async function assertSucceeds(p) { return await p; }
export async function assertFails(p) {
  try { await p; } catch (e) { if (e && e.code === 'permission-denied') return; throw e; }
  throw new Error('Expected the operation to FAIL with permission-denied, but it succeeded.');
}
export const loadRules = (path) => readFileSync(path, 'utf8');
