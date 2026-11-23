// Temporary two-UID live-test policy: materialised IN MEMORY from firestore.rules with fictional UIDs.
// Loopback emulator only. Real UIDs/deadlines are never stored here; this proves the gating mechanism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, serverTimestamp } from 'firebase/firestore';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:18080') throw Error('Tests require the isolated local Firestore emulator.');
const projectId = 'demo-invoice-studio-v2';
const baseRules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
const ORIGINAL = "return request.auth != null && request.auth.uid == uid";
assert.equal(baseRules.split(ORIGINAL).length, 2, 'owner() must contain the expected clause exactly once');

function scoped(uids, deadline) {
  const list = uids.map(u => `'${u}'`).join(', ');
  const out = baseRules.replace(ORIGINAL,
    `return request.auth != null && request.auth.uid in [${list}]\n        && request.time < timestamp.date(${deadline})\n        && request.auth.uid == uid`);
  assert.notEqual(out, baseRules);
  return out;
}
const DENY_ALL = "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if false;\n    }\n  }\n}\n";
const verified = { email_verified: true, firebase: { sign_in_provider: 'password' } };
const A = 'fictional-test-uid-a', B = 'fictional-test-uid-b', OUTSIDER = 'fictional-existing-unknown-user';
const profile = uid => ({ ownerUid: uid, schemaVersion: 1, displayName: 'Fictional Person', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

// The emulator can answer 500 while it is still compiling freshly supplied rules; retry the reset only.
async function clear(env) {
  for (let n = 0; ; n++) {
    try { return await env.clearFirestore(); }
    catch (e) { if (n >= 5) throw e; await new Promise(r => setTimeout(r, 300)); }
  }
}
async function withPolicy(rules, fn) {
  const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18080, rules } });
  try { await clear(env); await fn(env, (uid, token = verified) => env.authenticatedContext(uid, token).firestore()); }
  finally { await env.cleanup(); }
}
const p = (db, uid, rest = '') => doc(db, `users/${uid}${rest}`);

test('stage A admits only UID A; B and a verified outsider are denied even on their own paths', () =>
  withPolicy(scoped([A], '2999, 1, 1'), async (env, as) => {
    await assertSucceeds(setDoc(p(as(A), A), profile(A)));
    await assertSucceeds(getDoc(p(as(A), A)));
    await assertFails(setDoc(p(as(B), B), profile(B)));
    await assertFails(setDoc(p(as(OUTSIDER), OUTSIDER), profile(OUTSIDER)));
    await assertFails(getDoc(p(as(OUTSIDER), OUTSIDER)));
    await assertFails(getDoc(p(as(B), A)));
  }));

test('stage A/B admits both, each only to its own tree', () =>
  withPolicy(scoped([A, B], '2999, 1, 1'), async (env, as) => {
    await assertSucceeds(setDoc(p(as(A), A), profile(A)));
    await assertSucceeds(setDoc(p(as(B), B), profile(B)));
    await assertFails(getDoc(p(as(A), B)));
    await assertFails(getDoc(p(as(B), A)));
    await assertFails(setDoc(p(as(A), B), profile(B)));
    await assertFails(setDoc(p(as(OUTSIDER), OUTSIDER), profile(OUTSIDER)));
  }));

test('allowlisted UIDs still need verified email and the password provider', () =>
  withPolicy(scoped([A, B], '2999, 1, 1'), async (env, as) => {
    await assertFails(setDoc(p(as(A, { email_verified: false, firebase: { sign_in_provider: 'password' } }), A), profile(A)));
    await assertFails(setDoc(p(as(A, { email_verified: true, firebase: { sign_in_provider: 'google.com' } }), A), profile(A)));
    await assertFails(setDoc(p(as(A, { email_verified: true, firebase: { sign_in_provider: 'anonymous' } }), A), profile(A)));
    await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), `users/${A}/invoices`)));
  }));

test('expired deadline denies every UID, including allowlisted ones', () =>
  withPolicy(scoped([A, B], '2000, 1, 1'), async (env, as) => {
    await assertFails(setDoc(p(as(A), A), profile(A)));
    await assertFails(setDoc(p(as(B), B), profile(B)));
    await assertFails(getDoc(p(as(A), A)));
  }));

test('legacy PartyPulse rooms and unknown paths stay denied under the scoped policy', () =>
  withPolicy(scoped([A, B], '2999, 1, 1'), async (env, as) => {
    const db = as(A);
    await assertFails(getDoc(doc(db, 'rooms/fictional-room')));
    await assertFails(setDoc(doc(db, 'rooms/fictional-room'), { x: 1 }));
    await assertFails(getDocs(collection(db, 'rooms')));
    await assertFails(setDoc(doc(db, `users/${A}/unknown/x`), { x: 1 }));
    await assertFails(setDoc(doc(db, 'admins/a'), { x: 1 }));
  }));

test('scoped policy keeps every base validation (injected fields, bad counter)', () =>
  withPolicy(scoped([A], '2999, 1, 1'), async (env, as) => {
    const db = as(A);
    await assertFails(setDoc(p(db, A), { ...profile(A), role: 'admin' }));
    await assertFails(setDoc(p(db, A, '/counters/invoices'), { ownerUid: A, lastValue: 99, lastInvoiceId: 'x', updatedAt: serverTimestamp() }));
  }));

test('emergency deny-all rollback denies even previously admitted UIDs', async () => {
  await withPolicy(scoped([A, B], '2999, 1, 1'), async (env, as) => {
    await assertSucceeds(setDoc(p(as(A), A), profile(A)));
  });
  await withPolicy(DENY_ALL, async (env, as) => {
    await assertFails(getDoc(p(as(A), A)));
    await assertFails(setDoc(p(as(B), B), profile(B)));
    await assertFails(getDoc(doc(as(A), 'rooms/fictional-room')));
  });
});
