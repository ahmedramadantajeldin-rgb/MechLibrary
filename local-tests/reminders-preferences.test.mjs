// Run from the repository root:  node --test local-tests/reminders-preferences.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../reminders/preferences.js';

const fakeStorage = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };

test('nothing saved → [] (All subjects)', () => {
  assert.deepEqual(p.loadSubjects('u1', fakeStorage()), []);
  assert.deepEqual(p.loadSubjects(null, fakeStorage()), []);
});

test('save → load round-trip; keys are lower-cased, trimmed and de-duplicated', () => {
  const st = fakeStorage();
  assert.equal(p.saveSubjects('u1', ['Heat Transfer', ' heat transfer ', 'Fluid'], st), true);
  assert.deepEqual(p.loadSubjects('u1', st), ['heat transfer', 'fluid']);
});

test('each user (uid) and the visitor entry are separate; one never overwrites another', () => {
  const st = fakeStorage();
  p.saveSubjects('alice', ['a'], st); p.saveSubjects('bob', ['b', 'c'], st); p.saveSubjects(null, ['v'], st);
  assert.deepEqual(p.loadSubjects('alice', st), ['a']);
  assert.deepEqual(p.loadSubjects('bob', st), ['b', 'c']);
  assert.deepEqual(p.loadSubjects(null, st), ['v']);
  assert.deepEqual(p.loadSubjects('', st), ['v'], 'empty uid = visitor');
  p.saveSubjects('alice', ['z'], st);
  assert.deepEqual(p.loadSubjects('bob', st), ['b', 'c']);
  assert.equal(new Set([p.storageKey('alice'), p.storageKey('bob'), p.storageKey(null)]).size, 3);
});

test('saving [] removes the entry (same as never saved); other people are untouched', () => {
  const st = fakeStorage();
  p.saveSubjects('alice', ['a'], st); p.saveSubjects('bob', ['b'], st);
  p.saveSubjects('alice', [], st);
  assert.equal(st.getItem(p.storageKey('alice')), null);
  assert.deepEqual(p.loadSubjects('bob', st), ['b']);
});

test('only subject names are stored: no e-mail, no address of any kind', () => {
  const st = fakeStorage();
  p.saveSubjects('uid-123', ['heat transfer'], st);
  const [[k, v]] = [...st.m.entries()];
  assert.equal(v, '{"v":1,"subjects":["heat transfer"]}');
  assert.ok(k.includes('uid-123') && !/@|\d+\.\d+\.\d+\.\d+/.test(k + v));
});

test('corrupt / foreign / oversized stored data is ignored safely', () => {
  const st = fakeStorage(), key = p.storageKey('u');
  for (const bad of ['{not json', 'null', '42', '"x"', '[]', '{"v":2,"subjects":["a"]}', '{"v":1,"subjects":"a"}', '{"v":1,"subjects":[1,null,{},"  "]}']) {
    st.setItem(key, bad); assert.deepEqual(p.loadSubjects('u', st), [], bad);
  }
  st.setItem(key, JSON.stringify({ v: 1, subjects: ['ok', 'x'.repeat(500), 'OK'] }));
  assert.deepEqual(p.loadSubjects('u', st), ['ok'], 'over-long and duplicate entries dropped');
  st.setItem(key, JSON.stringify({ v: 1, subjects: Array.from({ length: 1000 }, (_, i) => 's' + i) }));
  assert.equal(p.loadSubjects('u', st).length, 200, 'bounded size');
});

test('unavailable or failing storage never throws', () => {
  assert.deepEqual(p.loadSubjects('u', null), []);
  assert.equal(p.saveSubjects('u', ['a'], null), false);
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  assert.deepEqual(p.loadSubjects('u', boom), []);
  assert.equal(p.saveSubjects('u', ['a'], boom), false);
  assert.equal(p.saveSubjects('u', [], boom), false);
});

test('odd uid values fall back to the visitor entry; very long ids are not used as keys', () => {
  assert.equal(p.storageKey(undefined), p.storageKey(null));
  assert.equal(p.storageKey(123), p.storageKey(null));
  assert.equal(p.storageKey('x'.repeat(200)), p.storageKey(null));
});
