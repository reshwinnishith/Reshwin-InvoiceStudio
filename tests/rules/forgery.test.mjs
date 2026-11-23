// Additional attack cases against firestore.rules: forged statuses/timestamps, type confusion, unsafe ids, reverting issued
// invoices. Loopback emulator only, fictional UIDs and data. Every case must be DENIED; one positive control per area.
import { before, after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:18080') throw Error('Tests require the isolated local Firestore emulator.');
const projectId = 'demo-invoice-studio-v2', uid = 'fictional-forger';
const verified = { email_verified: true, firebase: { sign_in_provider: 'password' } };
let env;
const db = () => env.authenticatedContext(uid, verified).firestore();
const inv = (s, id = 'fictional-inv') => doc(s, `users/${uid}/invoices/${id}`);
const ctr = s => doc(s, `users/${uid}/counters/invoices`);
const client = { name: 'Fictional Client', address: 'Example City', pan: '', gstin: '' };
const sender = { name: 'Fictional Sender', address: 'Example City', pan: '', bankName: '', bankBranch: '', accountNumber: '', accountType: '', ifsc: '' };
const draft = (o = {}) => ({ schemaVersion: 1, ownerUid: uid, status: 'draft', sequence: 0, number: '', date: '2026-11-20', currency: 'INR',
  description: 'Fictional work', clientId: 'fictional-client', clientSnapshot: client, senderSnapshot: sender, amountPaise: 10000, taxRate: 18,
  taxPaise: 1800, totalPaise: 11800, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), issuedAt: null, paidAt: null, voidedAt: null, ...o });
async function issueFirst(s, id = 'fictional-inv') {
  const b = writeBatch(s);
  b.update(inv(s, id), { status: 'issued', sequence: 1, number: 'RESH-2026-001', issuedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.set(ctr(s), { ownerUid: uid, lastValue: 1, lastInvoiceId: id, updatedAt: serverTimestamp() });
  return b.commit();
}

before(async () => { env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18080, rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') } }); });
after(async () => env?.cleanup());
beforeEach(async () => {
  for (let n = 0; ; n++) { try { return await env.clearFirestore(); } catch (e) { if (n >= 5) throw e; await new Promise(r => setTimeout(r, 300)); } }
});

test('an invoice cannot be created already issued, paid or void, even with a well-formed number', async () => {
  const s = db();
  for (const status of ['issued', 'paid', 'void']) {
    await assertFails(setDoc(inv(s), draft({ status, sequence: 1, number: 'RESH-2026-001', issuedAt: serverTimestamp(),
      paidAt: status === 'paid' ? serverTimestamp() : null, voidedAt: status === 'void' ? serverTimestamp() : null })));
  }
  await assertSucceeds(setDoc(inv(s), draft()));
});

test('client-chosen timestamps are refused (createdAt/updatedAt must be the server time)', async () => {
  const s = db(), past = Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'));
  await assertFails(setDoc(inv(s), draft({ createdAt: past })));
  await assertFails(setDoc(inv(s), draft({ updatedAt: past })));
  await assertFails(setDoc(doc(s, `users/${uid}/clients/c1`), { ...client, ownerUid: uid, schemaVersion: 1, createdAt: past, updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(inv(s), draft()));
  await assertFails(updateDoc(inv(s), { description: 'Fictional edit', updatedAt: past }));
  await assertFails(updateDoc(inv(s), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});

test('type confusion is refused: numbers as strings, fractional sequence, non-map snapshots', async () => {
  const s = db();
  for (const o of [{ amountPaise: '10000' }, { taxRate: '18' }, { taxPaise: '1800' }, { totalPaise: '11800' }, { sequence: 0.5 },
    { clientSnapshot: 'Fictional Client' }, { senderSnapshot: null }, { description: ['Fictional'] }, { schemaVersion: '1' }, { date: 20261120 }]) {
    await assertFails(setDoc(inv(s), draft(o)));
  }
});

test('unsafe or oversized document ids are refused', async () => {
  const s = db();
  for (const id of ['x'.repeat(129), 'has space', 'dot.id', 'émoji']) await assertFails(setDoc(inv(s, id), draft()));
  await assertSucceeds(setDoc(inv(s, 'Fictional_ID-1'), draft()));
});

test('an issued invoice cannot be reverted to a draft, renumbered, or re-dated, and terminal states cannot switch', async () => {
  const s = db();
  await assertSucceeds(setDoc(inv(s), draft()));
  await assertSucceeds(issueFirst(s));
  await assertFails(updateDoc(inv(s), { status: 'draft', sequence: 0, number: '', issuedAt: null, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(inv(s), { number: 'RESH-2026-002', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(inv(s), { date: '2027-01-01', number: 'RESH-2027-001', updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(inv(s)));
  await assertSucceeds(updateDoc(inv(s), { status: 'paid', paidAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(inv(s), { status: 'void', voidedAt: serverTimestamp(), paidAt: null, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(inv(s), { status: 'issued', paidAt: null, updatedAt: serverTimestamp() }));
});

test('profile, sender and counter documents cannot be deleted by the owner', async () => {
  const s = db();
  await assertSucceeds(setDoc(doc(s, `users/${uid}`), { ownerUid: uid, schemaVersion: 1, displayName: 'Fictional', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(s, `users/${uid}/settings/sender`), { ...sender, ownerUid: uid, schemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(inv(s), draft())); await assertSucceeds(issueFirst(s));
  for (const p of [`users/${uid}`, `users/${uid}/settings/sender`, `users/${uid}/counters/invoices`]) await assertFails(deleteDoc(doc(s, p)));
});
