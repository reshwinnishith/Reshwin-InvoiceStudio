import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloud } from '../../cloud.mjs';
import core from '../../core.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(extra = {}, options = {}) {
  let changed;
  const auth = { currentUser: null };
  const cloud = createCloud({ auth, db: {}, core, A: { onAuthStateChanged: (_a, cb) => { changed = cb; return () => {}; } },
    F: { collection: () => ({}), doc: () => ({}), onSnapshot: () => () => {}, ...extra }, ...options });
  const user = uid => ({ uid, email: uid + '@example.test', emailVerified: true, getIdToken: async () => {}, reload: async () => {} });
  return { auth, cloud, user, async change(u) { auth.currentUser = u; await changed(u); } };
}
test('verification finishing after logout cannot restore the old ready session', async () => {
  const f = fixture(), a = f.user('a'); await f.change(a);
  const gate = deferred(); a.getIdToken = () => gate.promise;
  const pending = f.cloud.refreshVerification(); await Promise.resolve();
  await f.change(null); gate.resolve(); await pending;
  assert.equal(f.cloud.session.status, 'signedOut'); f.cloud.dispose();
});
test('auth events from the same UID cannot supersede a newer sign-out/sign-in', async () => {
  const f = fixture(), a = f.user('a'), gate = deferred(); a.getIdToken = () => gate.promise;
  const old = f.change(a); await f.change(null);
  const newer = f.user('a'); newer.emailVerified = false; await f.change(newer);
  gate.resolve(); await old;
  assert.equal(f.cloud.session.status, 'unverified'); f.cloud.dispose();
});
test('closing a workspace during a transaction aborts before it can commit', async () => {
  const gate = deferred(); let committed = false;
  const f = fixture({ serverTimestamp: () => 1, runTransaction: async (_db, fn) => {
    const result = await fn({ get: async () => { await gate.promise; return { exists: () => false }; }, set() {} });
    committed = true; return result;
  } });
  await f.change(f.user('a')); const ws = f.cloud.openWorkspace('a', {});
  const save = ws.ensureProfile('Fictional'); ws.close(); gate.resolve();
  await assert.rejects(save, e => e.code === 'account-changed'); assert.equal(committed, false); f.cloud.dispose();
});
test('an old workspace cannot revive when the same account signs in again', async () => {
  const f = fixture(); await f.change(f.user('a')); const ws = f.cloud.openWorkspace('a', {});
  await f.change(null); await f.change(f.user('a'));
  await assert.rejects(ws.ensureProfile('Fictional'), e => e.code === 'account-changed'); f.cloud.dispose();
});
test('a timed-out transaction callback cannot resume and commit later', async () => {
  const gate = deferred(); let committed = false;
  const f = fixture({ serverTimestamp: () => 1, runTransaction: async (_db, fn) => {
    await fn({ get: async () => { await gate.promise; return { exists: () => false }; }, set() {} }); committed = true;
  } }, { timeoutMs: 10 });
  await f.change(f.user('a')); const ws = f.cloud.openWorkspace('a', {});
  await assert.rejects(ws.ensureProfile('Fictional'), e => e.code === 'timeout');
  gate.resolve(); await new Promise(r => setImmediate(r)); assert.equal(committed, false); f.cloud.dispose();
});
