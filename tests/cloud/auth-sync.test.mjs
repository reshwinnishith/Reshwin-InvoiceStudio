import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, F, core, makeClient, until, sleep, verifyEmailViaEmulator, resetCodes, PASSWORD, sender, client, input, freshEmail, readyUser } from './helpers.mjs';
import { CloudError, describeAuthError } from '../../cloud.mjs';

const seed = async u => {
  await u.ws.saveSender(sender);
  const cid = await u.ws.saveClient(client);
  await until(() => u.data().clients.length === 1 && u.data().sender, 'seed visible');
  return cid;
};

test('sign-up creates an unverified account that cannot reach private data until verified', async () => {
  const c = makeClient(); const email = freshEmail();
  const r = await c.cloud.signUp(email, PASSWORD);
  assert.equal(r.verificationSent, true);
  await until(() => c.cloud.session.status === 'unverified', 'unverified');
  assert.throws(() => c.cloud.openWorkspace(c.auth.currentUser.uid, {}), e => e.code === 'not-ready');
  // Rules independently deny an unverified token even if client code is bypassed.
  await assert.rejects(F.getDoc(F.doc(c.db, 'users', c.auth.currentUser.uid, 'settings', 'sender')), e => e.code === 'permission-denied');
  await assert.rejects(F.setDoc(F.doc(c.db, 'users', c.auth.currentUser.uid), { ownerUid: c.auth.currentUser.uid }), e => e.code === 'permission-denied');
  await verifyEmailViaEmulator(email);
  const s = await c.cloud.refreshVerification();
  assert.equal(s.status, 'ready');
  await c.close();
});

test('profile document is created once for a verified account and is readable only by its owner', async () => {
  const u = await readyUser();
  await u.ws.ensureProfile('fictional'); await u.ws.ensureProfile('changed-name-is-ignored');
  const snap = await F.getDocFromServer(F.doc(u.c.db, 'users', u.uid));
  assert.equal(snap.data().displayName, 'fictional'); assert.equal(snap.data().ownerUid, u.uid);
  const other = await readyUser();
  await assert.rejects(F.getDocFromServer(F.doc(other.c.db, 'users', u.uid)), e => e.code === 'permission-denied');
  await other.c.close(); await u.c.close();
});

test('resend verification is rate limited client-side and works after the cooldown', async () => {
  const c = makeClient(); const email = freshEmail();
  await c.cloud.signUp(email, PASSWORD);
  await assert.rejects(c.cloud.resendVerification({ cooldownMs: 60000 }), e => e.code === 'cooldown');
  await c.cloud.resendVerification({ cooldownMs: 0 });
  await c.close();
});

test('sign-in errors are friendly and identical for unknown user and wrong password', async () => {
  const u = await readyUser();
  const c2 = makeClient();
  const errs = [];
  for (const [e, p] of [[u.email, 'wrong-password-123456'], [freshEmail(), PASSWORD]]) {
    try { await c2.cloud.signIn(e, p); assert.fail('should not sign in'); } catch (err) { errs.push(describeAuthError(err)); }
  }
  assert.equal(errs[0], errs[1]); assert.match(errs[0], /incorrect/i);
  await c2.close(); await u.c.close();
});

test('password reset gives no account-enumeration signal and issues a reset code only for real accounts', async () => {
  const u = await readyUser(); const c2 = makeClient();
  await c2.cloud.requestPasswordReset(u.email);
  await c2.cloud.requestPasswordReset(freshEmail());
  assert.equal((await resetCodes(u.email)).length, 1);
  await c2.close(); await u.c.close();
});

test('owner can create sender/client/draft, issue with RESH numbering, pay; issued data is protected', async () => {
  const u = await readyUser(); const cid = await seed(u);
  const iid = await u.ws.saveDraft(null, input({ clientId: cid }), { id: cid, ...client }, sender);
  await until(() => u.data().invoices.length === 1, 'draft visible');
  let inv = u.data().invoices[0];
  assert.equal(inv.status, 'draft'); assert.equal(inv.no, ''); assert.equal(inv.totalPaise, 118000);
  const issued = await u.ws.issue(iid, inv.updateToken);
  assert.deepEqual(issued, { sequence: 1, number: 'RESH-2026-001' });
  await until(() => u.data().invoices[0].status === 'issued', 'issued visible');
  inv = u.data().invoices[0];
  assert.equal(inv.no, 'RESH-2026-001'); assert.equal(u.data().counter, 1);
  await assert.rejects(u.ws.saveDraft(iid, input({ clientId: cid, amount: '5' }), { id: cid, ...client }, sender, inv.updateToken), e => e.code === 'locked');
  await assert.rejects(u.ws.deleteDraft(iid), e => e.code === 'locked');
  await u.ws.setStatus(iid, 'paid', inv.updateToken);
  await until(() => u.data().invoices[0].status === 'paid', 'paid visible');
  await assert.rejects(u.ws.setStatus(iid, 'void', u.data().invoices[0].updateToken), e => e.code === 'conflict');
  // Bypassing the data layer: direct writes to frozen content are rejected by the rules.
  await assert.rejects(F.updateDoc(F.doc(u.c.db, 'users', u.uid, 'invoices', iid), { description: 'tampered', updatedAt: F.serverTimestamp() }), e => e.code === 'permission-denied');
  await assert.rejects(F.setDoc(F.doc(u.c.db, 'users', u.uid, 'counters', 'invoices'), { ownerUid: u.uid, lastValue: 1, lastInvoiceId: iid, updatedAt: F.serverTimestamp() }), e => e.code === 'permission-denied');
  await u.c.close();
});

test('sender details: updates carry the token; a stale token is a conflict', async () => {
  const u = await readyUser(); await u.ws.saveSender(sender);
  await until(() => u.data().senderToken, 'sender visible');
  const t1 = u.data().senderToken;
  await u.ws.saveSender({ ...sender, bank: 'Second Bank' }, t1);
  await until(() => u.data().sender.bank === 'Second Bank' && u.data().senderToken !== t1, 'second save visible');
  await assert.rejects(u.ws.saveSender({ ...sender, bank: 'Stale' }, t1), e => e.code === 'conflict');
  assert.equal(u.data().sender.bank, 'Second Bank');
  await u.c.close();
});

test('numbers are gapless per account, year comes from the invoice date, drafts do not consume numbers', async () => {
  const u = await readyUser(); const cid = await seed(u);
  const mk = async date => u.ws.saveDraft(null, input({ clientId: cid, date }), { id: cid, ...client }, sender);
  const [a, b, d] = [await mk('2026-12-30'), await mk('2027-01-02'), await mk('2027-01-03')];
  await until(() => u.data().invoices.length === 3, 'three drafts');
  assert.equal(u.data().counter, 0);
  await u.ws.deleteDraft(d);
  const tok = id => u.data().invoices.find(x => x.id === id).updateToken;
  assert.equal((await u.ws.issue(a, tok(a))).number, 'RESH-2026-001');
  await until(() => u.data().counter === 1, 'counter 1');
  assert.equal((await u.ws.issue(b, tok(b))).number, 'RESH-2027-002');
  await u.c.close();
});

test('two devices issuing at the same time receive distinct numbers (transaction safety)', async () => {
  const u = await readyUser(); const cid = await seed(u);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await u.ws.saveDraft(null, input({ clientId: cid, reg: 'Job ' + i }), { id: cid, ...client }, sender));
  await until(() => u.data().invoices.length === 4, 'drafts visible');
  // A second device: same account, separate app instance.
  const dev2 = makeClient(); await dev2.cloud.signIn(u.email, PASSWORD);
  await until(() => dev2.cloud.session.status === 'ready', 'device 2 ready');
  let d2 = null; const ws2 = dev2.cloud.openWorkspace(dev2.auth.currentUser.uid, { onData: (d, m) => { d2 = { ...d, m }; } });
  await until(() => d2?.m.ready && d2.invoices.length === 4, 'device 2 sees drafts');
  const tok = (d, id) => d.invoices.find(x => x.id === id).updateToken;
  const results = await Promise.all([
    u.ws.issue(ids[0], tok(u.data(), ids[0])), ws2.issue(ids[1], tok(d2, ids[1])),
    u.ws.issue(ids[2], tok(u.data(), ids[2])), ws2.issue(ids[3], tok(d2, ids[3]))
  ]);
  assert.deepEqual(results.map(r => r.sequence).sort(), [1, 2, 3, 4]);
  assert.equal(new Set(results.map(r => r.number)).size, 4);
  await until(() => d2.counter === 4 && u.data().counter === 4, 'counter converged on both devices');
  ws2.close(); await dev2.close(); await u.c.close();
});

test('stale edits are rejected as conflicts instead of overwriting another device', async () => {
  const u = await readyUser(); const cid = await seed(u);
  const iid = await u.ws.saveDraft(null, input({ clientId: cid }), { id: cid, ...client }, sender);
  await until(() => u.data().invoices.length === 1, 'draft');
  const stale = u.data().invoices[0].updateToken;
  await u.ws.saveDraft(iid, input({ clientId: cid, reg: 'Edited elsewhere' }), { id: cid, ...client }, sender, stale);
  await assert.rejects(u.ws.saveDraft(iid, input({ clientId: cid, reg: 'Stale overwrite' }), { id: cid, ...client }, sender, stale), e => e.code === 'conflict');
  await until(() => u.data().invoices[0].reg === 'Edited elsewhere', 'edit visible');
  await assert.rejects(u.ws.issue(iid, stale), e => e.code === 'conflict');
  assert.equal(u.data().counter, 0, 'a rejected issue must not burn a number');
  await u.c.close();
});

test('invalid input never reaches Firestore (no phantom records)', async () => {
  const u = await readyUser(); const cid = await seed(u);
  await assert.rejects(u.ws.saveSender({ name: '', addr: '' }), e => e.code === 'invalid');
  await assert.rejects(u.ws.saveClient({ name: 'X', pan: 'bad' }), e => e.code === 'invalid');
  await assert.rejects(u.ws.saveDraft(null, { ...input({ clientId: cid }), amountPaise: -5 }, { id: cid, ...client }, sender), e => e.code === 'permission' || e.code === 'invalid');
  await sleep(300);
  assert.equal(u.data().invoices.length, 0);
  await u.c.close();
});

test('a write that cannot reach the server is reported as failed and leaves no record', async () => {
  // Same verified account, but this device cannot reach Firestore (dead loopback port) -> a genuine network failure.
  const email = freshEmail();
  const good = await readyUser(email); const cid = await seed(good);
  const bad = makeClient({ timeoutMs: 4000 }, 18999);
  await bad.cloud.signIn(email, PASSWORD); await until(() => bad.cloud.session.status === 'ready', 'offline device ready');
  const ws = bad.cloud.openWorkspace(bad.auth.currentUser.uid, { onData() {}, onError() {} });
  const err = await ws.saveDraft(null, input({ clientId: cid }), { id: cid, ...client }, sender).then(() => null, e => e);
  assert.ok(err instanceof CloudError, 'must fail, not pretend success'); assert.ok(['offline', 'timeout'].includes(err.code), err.code);
  await sleep(500);
  assert.equal((await F.getDocsFromServer(F.collection(good.c.db, 'users', good.uid, 'invoices'))).size, 0, 'nothing was written or queued');
  ws.close(); await bad.close(); await good.c.close();
});

test('account isolation: another user cannot read, list, write or see anything, and switching accounts clears state', async () => {
  const a = await readyUser(); const cidA = await seed(a);
  const iidA = await a.ws.saveDraft(null, input({ clientId: cidA }), { id: cidA, ...client }, sender);
  await until(() => a.data().invoices.length === 1, 'A draft');
  // B signs in on the SAME app instance (account switch).
  const bEmail = freshEmail();
  const b = makeClient(); await b.cloud.signUp(bEmail, PASSWORD); await verifyEmailViaEmulator(bEmail); await b.cloud.refreshVerification();
  await until(() => b.cloud.session.status === 'ready', 'B ready');
  const rawA = p => F.doc(b.db, 'users', a.uid, ...p);
  await assert.rejects(F.getDoc(rawA(['invoices', iidA])), e => e.code === 'permission-denied');
  await assert.rejects(F.getDocs(F.collection(b.db, 'users', a.uid, 'invoices')), e => e.code === 'permission-denied');
  await assert.rejects(F.setDoc(rawA(['clients', 'evil']), { ownerUid: b.auth.currentUser.uid }), e => e.code === 'permission-denied');
  await assert.rejects(F.deleteDoc(rawA(['invoices', iidA])), e => e.code === 'permission-denied');
  await assert.rejects(F.setDoc(rawA(['counters', 'invoices']), { ownerUid: a.uid, lastValue: 1000, lastInvoiceId: iidA, updatedAt: F.serverTimestamp() }), e => e.code === 'permission-denied');
  assert.throws(() => b.cloud.openWorkspace(a.uid, {}), e => e.code === 'not-ready');
  // Account switch on one app: A's workspace must stop receiving data and reject stale operations.
  let seenByA = 0; const c = makeClient(); await c.cloud.signIn(a.email, PASSWORD); await until(() => c.cloud.session.status === 'ready', 'A re-ready');
  const wsA = c.cloud.openWorkspace(c.auth.currentUser.uid, { onData: () => { seenByA++; } });
  await until(() => seenByA >= 4, 'A data');
  await c.cloud.signOut(); await until(() => c.cloud.session.status === 'signedOut', 'signed out');
  const before = seenByA;
  await assert.rejects(wsA.saveSender(sender), e => e.code === 'account-changed');
  await c.cloud.signIn(bEmail, PASSWORD); await until(() => c.cloud.session.status === 'ready' && c.cloud.session.uid !== a.uid, 'switched to B');
  let bData = null; const wsB = c.cloud.openWorkspace(c.auth.currentUser.uid, { onData: (d, m) => { bData = { ...d, m }; } });
  await until(() => bData?.m.ready, 'B snapshot');
  assert.equal(bData.invoices.length, 0); assert.equal(bData.clients.length, 0); assert.equal(bData.sender, null); assert.equal(bData.counter, 0);
  await assert.rejects(wsA.saveSender(sender), e => e.code === 'account-changed', 'old workspace stays dead after switching');
  assert.equal(seenByA, before, 'no callbacks reach the old account handlers');
  wsB.close(); await c.close(); await b.close(); await a.c.close();
});

test('closing a workspace detaches all listeners immediately', async () => {
  const u = await readyUser(); await seed(u);
  let calls = 0; const ws = u.c.cloud.openWorkspace(u.uid, { onData: () => { calls++; } });
  await until(() => calls >= 4, 'snapshots'); ws.close(); const n = calls;
  await u.ws.saveClient({ name: 'Another', addr: '', pan: '', gstin: '' });
  await sleep(500); assert.equal(calls, n);
  await u.c.close();
});
