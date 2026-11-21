import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  writeBatch, runTransaction, serverTimestamp, Timestamp, getDocFromServer } from 'firebase/firestore';

const projectId = 'demo-invoice-studio-v2';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host !== '127.0.0.1:18080') throw Error('Tests require the isolated local Firestore emulator.');
const num = (seq, year = '2026') => `RESH-${year}-${String(seq).padStart(3, '0')}`;
const verified = { email_verified: true, firebase: { sign_in_provider: 'password' } };
let env;
const db = (uid = 'fictional-alice', options = verified) => env.authenticatedContext(uid, options).firestore();
const ref = (store, uid, kind, id) => doc(store, `users/${uid}/${kind}/${id}`);
const invoiceRef = (store, id = 'fictional-invoice-1', uid = 'fictional-alice') => ref(store, uid, 'invoices', id);
const counterRef = (store, uid = 'fictional-alice') => ref(store, uid, 'counters', 'invoices');
const client = { name: 'Fictional Client', address: 'Example City', pan: '', gstin: '' };
const sender = { name: 'Fictional Sender', address: 'Example City', pan: '', bankName: '',
  bankBranch: '', accountNumber: '', accountType: '', ifsc: '' };
const profile = uid => ({ ownerUid: uid, schemaVersion: 1, displayName: 'Fictional Person',
  createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const draft = (overrides = {}, uid = 'fictional-alice') => ({ schemaVersion: 1, ownerUid: uid,
  status: 'draft', sequence: 0, number: '', date: '2026-11-20', currency: 'INR',
  description: 'Fictional design services', clientId: 'fictional-client', clientSnapshot: client,
  senderSnapshot: sender, amountPaise: 10000, taxRate: 18, taxPaise: 1800, totalPaise: 11800,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), issuedAt: null, paidAt: null,
  voidedAt: null, ...overrides });

async function issue(store, id = 'fictional-invoice-1', uid = 'fictional-alice') {
  const invoice = invoiceRef(store, id, uid), counter = counterRef(store, uid);
  // Rules can reject a stale counter before the emulator returns ABORTED.
  // Retry only if a fresh server read proves actual counter advancement and
  // this same invoice is still a draft. Never blanket-retry authorization errors.
  for (let attempt = 0; attempt < 5; attempt++) {
    let observed = -1;
    try {
      return await runTransaction(store, async tx => {
        const [a, b] = await Promise.all([tx.get(invoice), tx.get(counter)]);
        assert.equal(a.data().status, 'draft');
        observed = b.exists() ? b.data().lastValue : 0;
        const next = observed + 1;
        tx.update(invoice, { status: 'issued', sequence: next, number: num(next),
          issuedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        tx.set(counter, { ownerUid: uid, lastValue: next, lastInvoiceId: id, updatedAt: serverTimestamp() });
        return next;
      });
    } catch (error) {
      if (error.code !== 'permission-denied' || attempt === 4 || observed < 0) throw error;
      const [a, b] = await Promise.all([getDocFromServer(invoice), getDocFromServer(counter)]);
      if (!a.exists() || a.data().status !== 'draft' || !b.exists() || b.data().lastValue <= observed) throw error;
    }
  }
}

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 18080,
    rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => env.clearFirestore());
after(async () => env?.cleanup());

test('verified password owner can create/read own profile, client, sender and draft', async () => {
  const store = db(), uid = 'fictional-alice';
  await assertSucceeds(setDoc(doc(store, `users/${uid}`), profile(uid)));
  await assertSucceeds(setDoc(ref(store, uid, 'clients', 'fictional-client'), {
    ...client, ownerUid: uid, schemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(ref(store, uid, 'settings', 'sender'), {
    ...sender, ownerUid: uid, schemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(invoiceRef(store), draft()));
  await assertSucceeds(getDocs(collection(store, `users/${uid}/invoices`)));
});

test('unauthenticated requests cannot read or write any Invoice Studio path', async () => {
  const store = env.unauthenticatedContext().firestore();
  for (const path of ['users/fictional-alice', 'users/fictional-alice/invoices/x',
    'users/fictional-alice/clients/x', 'users/fictional-alice/settings/sender',
    'users/fictional-alice/counters/invoices']) {
    await assertFails(getDoc(doc(store, path)));
    await assertFails(setDoc(doc(store, path), draft()));
  }
});

test('unverified email, anonymous and other providers cannot access private data', async () => {
  for (const auth of [
    { email_verified: false, firebase: { sign_in_provider: 'password' } },
    { email_verified: true, firebase: { sign_in_provider: 'anonymous' } },
    { email_verified: true, firebase: { sign_in_provider: 'google.com' } }
  ]) await assertFails(setDoc(invoiceRef(db('fictional-alice', auth)), draft()));
});

test('cross-account get, list, create, update and delete are denied', async () => {
  const alice = db(), bob = db('fictional-bob');
  await setDoc(invoiceRef(alice), draft());
  await assertFails(getDoc(invoiceRef(bob)));
  await assertFails(getDocs(collection(bob, 'users/fictional-alice/invoices')));
  await assertFails(setDoc(invoiceRef(bob, 'attack'), draft({}, 'fictional-bob')));
  await assertFails(updateDoc(invoiceRef(bob), { description: 'Malicious update', updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(invoiceRef(bob)));
  for (const path of ['users/fictional-alice', 'users/fictional-alice/clients/x',
    'users/fictional-alice/settings/sender', 'users/fictional-alice/counters/invoices']) {
    await assertFails(getDoc(doc(bob, path)));
    await assertFails(setDoc(doc(bob, path), {}));
  }
});

test('PartyPulse rooms, unknown paths and unexpected nested collections stay closed', async () => {
  for (const store of [db(), env.unauthenticatedContext().firestore()]) {
    for (const path of ['rooms/fictional-room', 'unexpected/x', 'users/fictional-alice/admin/x',
      'users/fictional-alice/invoices/x/secret/y', 'users/fictional-alice/settings/other']) {
      await assertFails(getDoc(doc(store, path)));
      await assertFails(setDoc(doc(store, path), {}));
    }
  }
});

test('malicious owner, schema and privilege fields cannot be injected', async () => {
  const store = db();
  for (const patch of [{ ownerUid: 'fictional-bob' }, { admin: true }, { schemaVersion: 2 },
    { clientSnapshot: { ...client, role: 'admin' } }, { senderSnapshot: { ...sender, secret: 'fictional' } }]) {
    await assertFails(setDoc(invoiceRef(store), draft(patch)));
  }
  await assertFails(setDoc(doc(store, 'users/fictional-alice'), { ...profile('fictional-alice'), role: 'admin' }));
});

test('invalid amounts, fractions, overflow, tax, totals, dates and currency are denied', async () => {
  const store = db();
  for (const patch of [{ amountPaise: -1 }, { amountPaise: 0 }, { amountPaise: 1.5 },
    { amountPaise: 10000000001 }, { amountPaise: NaN }, { amountPaise: Infinity },
    { taxRate: 7 }, { taxPaise: 1799 }, { taxPaise: 1801 }, { totalPaise: 1 },
    { currency: 'USD' }, { description: '' }, { description: '   ' }, { description: 'x'.repeat(4001) },
    { date: '2026-13-01' }, { date: 'not-a-date' }, { issuedAt: Timestamp.now() }]) {
    await assertFails(setDoc(invoiceRef(store), draft(patch)));
  }
});

test('calendar validation handles leap years and rejects nonexistent days', async () => {
  const store = db();
  for (const date of ['2026-02-29', '2026-04-31', '1900-02-29', '0000-01-01', '2026-00-01']) {
    await assertFails(setDoc(invoiceRef(store), draft({ date })));
  }
  for (const [i, date] of ['2024-02-29', '2000-02-29', '2026-04-30'].entries()) {
    await assertSucceeds(setDoc(invoiceRef(store, `date-${i}`), draft({ date })));
  }
});

test('tax half-up boundary and maximum monetary value work', async () => {
  const store = db();
  await assertSucceeds(setDoc(invoiceRef(store, 'half'), draft({ amountPaise: 10, taxRate: 5, taxPaise: 1, totalPaise: 11 })));
  await assertFails(setDoc(invoiceRef(store, 'bad-half'), draft({ amountPaise: 10, taxRate: 5, taxPaise: 0, totalPaise: 10 })));
  await assertSucceeds(setDoc(invoiceRef(store, 'max'), draft({ amountPaise: 10000000000, taxRate: 28,
    taxPaise: 2800000000, totalPaise: 12800000000 })));
});

test('client/sender validation rejects unexpected fields and invalid banking/tax formats', async () => {
  const store = db(), uid = 'fictional-alice';
  const base = { ownerUid: uid, schemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertFails(setDoc(ref(store, uid, 'clients', 'x'), { ...client, ...base, admin: true }));
  await assertFails(setDoc(ref(store, uid, 'clients', 'x'), { ...client, ...base, pan: 'INVALID' }));
  await assertFails(setDoc(ref(store, uid, 'settings', 'sender'), { ...sender, ...base, accountNumber: 'abc' }));
  await assertFails(setDoc(ref(store, uid, 'settings', 'sender'), { ...sender, ...base, ifsc: 'invalid' }));
});

test('draft edits preserve creation time and require server update time', async () => {
  const store = db(); await setDoc(invoiceRef(store), draft());
  await assertSucceeds(updateDoc(invoiceRef(store), { description: 'Updated fictional draft', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(invoiceRef(store), { createdAt: Timestamp.fromMillis(0), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(invoiceRef(store), { updatedAt: Timestamp.fromMillis(0) }));
});

test('issuing requires an existing draft and atomically creates the first counter', async () => {
  const store = db();
  await assertFails(setDoc(invoiceRef(store), draft({ status: 'issued', sequence: 1, number: num(1), issuedAt: serverTimestamp() })));
  await setDoc(invoiceRef(store), draft());
  await assertFails(updateDoc(invoiceRef(store), { status: 'issued', sequence: 1, number: num(1), issuedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  assert.equal(await assertSucceeds(issue(store)), 1);
  assert.equal((await getDoc(counterRef(store))).data().lastValue, 1);
});

test('issued content, numbering, ownership, snapshots and deletion are immutable', async () => {
  const store = db(); await setDoc(invoiceRef(store), draft()); await issue(store);
  for (const patch of [{ description: 'Tampered' }, { number: num(999) }, { sequence: 99 },
    { ownerUid: 'fictional-bob' }, { clientSnapshot: { ...client, name: 'Changed' } },
    { senderSnapshot: { ...sender, name: 'Changed' } }, { amountPaise: 20000, taxPaise: 3600, totalPaise: 23600 },
    { date: '2026-11-21' }, { status: 'draft', sequence: 0, number: '', issuedAt: null }]) {
    await assertFails(updateDoc(invoiceRef(store), { ...patch, updatedAt: serverTimestamp() }));
  }
  await assertFails(deleteDoc(invoiceRef(store)));
});

test('issue cannot also mutate the frozen content', async () => {
  const store = db(); await setDoc(invoiceRef(store), draft());
  const batch = writeBatch(store);
  batch.update(invoiceRef(store), { status: 'issued', sequence: 1, number: num(1), description: 'Changed while issuing',
    issuedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(counterRef(store), { ownerUid: 'fictional-alice', lastValue: 1, lastInvoiceId: 'fictional-invoice-1', updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test('issued to paid or void is allowed; terminal states and timestamps are locked', async () => {
  const store = db();
  for (const status of ['paid', 'void']) {
    const id = `fictional-${status}`; await setDoc(invoiceRef(store, id), draft()); await issue(store, id);
    const field = status === 'paid' ? 'paidAt' : 'voidedAt';
    await assertFails(updateDoc(invoiceRef(store, id), { status, [field]: Timestamp.fromMillis(0), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(invoiceRef(store, id), { status, [field]: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(invoiceRef(store, id), { status: 'issued', [field]: null, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(invoiceRef(store, id), { description: 'Tampered', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(invoiceRef(store, id)));
  }
});

test('standalone counter creation, jumps, reset, deletion and extra fields are denied', async () => {
  const store = db();
  await assertFails(setDoc(counterRef(store), { ownerUid: 'fictional-alice', lastValue: 1, lastInvoiceId: 'absent', updatedAt: serverTimestamp() }));
  await setDoc(invoiceRef(store), draft()); await issue(store);
  for (const patch of [{ lastValue: 2 }, { lastValue: 99 }, { lastValue: 0 }, { lastValue: 1.5 },
    { ownerUid: 'fictional-bob' }, { extra: true }, { lastInvoiceId: 'absent' }]) {
    await assertFails(updateDoc(counterRef(store), { ...patch, updatedAt: serverTimestamp() }));
  }
  await assertFails(deleteDoc(counterRef(store)));
});

test('counter-only issue, skipped numbers and wrong invoice linkage fail atomically', async () => {
  const store = db(); await setDoc(invoiceRef(store), draft());
  for (const [sequence, lastInvoiceId] of [[2, 'fictional-invoice-1'], [1, 'other-invoice']]) {
    const batch = writeBatch(store);
    batch.update(invoiceRef(store), { status: 'issued', sequence, number: num(sequence), issuedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(counterRef(store), { ownerUid: 'fictional-alice', lastValue: sequence, lastInvoiceId, updatedAt: serverTimestamp() });
    await assertFails(batch.commit());
  }
});

test('one counter increment cannot issue two drafts', async () => {
  const store = db(); await setDoc(invoiceRef(store, 'a'), draft()); await setDoc(invoiceRef(store, 'b'), draft());
  const batch = writeBatch(store);
  for (const id of ['a', 'b']) batch.update(invoiceRef(store, id), { status: 'issued', sequence: 1, number: num(1), issuedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(counterRef(store), { ownerUid: 'fictional-alice', lastValue: 1, lastInvoiceId: 'b', updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test('concurrent issue transactions allocate distinct monotonically increasing numbers', async () => {
  const store = db(); await setDoc(invoiceRef(store, 'a'), draft()); await setDoc(invoiceRef(store, 'b'), draft());
  assert.deepEqual((await Promise.all([issue(store, 'a'), issue(store, 'b')])).sort(), [1, 2]);
});

test('draft deletion does not reset or consume a counter', async () => {
  const store = db(); await setDoc(invoiceRef(store), draft()); await assertSucceeds(deleteDoc(invoiceRef(store)));
  assert.equal((await getDoc(counterRef(store))).exists(), false);
});

test('RESH-YYYY-NNN numbering is enforced by the rules: format, padding, year from invoice date', async () => {
  const store = db();
  const tryIssue = async (id, number) => {
    const batch = writeBatch(store);
    batch.update(invoiceRef(store, id), { status: 'issued', sequence: 1, number, issuedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(counterRef(store), { ownerUid: 'fictional-alice', lastValue: 1, lastInvoiceId: id, updatedAt: serverTimestamp() });
    return batch.commit();
  };
  await setDoc(invoiceRef(store, 'a'), draft({ date: '2026-11-20' }));
  for (const bad of ['RIS-1', 'RESH-2026-1', 'RESH-2027-001', 'RESH-26-001', 'resh-2026-001', 'RESH-2026-0001', '', 'RESH-2026-001 ']) {
    await assertFails(tryIssue('a', bad));
  }
  await assertSucceeds(tryIssue('a', 'RESH-2026-001'));
  // The year follows the invoice date, not the current date.
  await setDoc(invoiceRef(store, 'b'), draft({ date: '2027-01-05' }));
  const second = writeBatch(store);
  second.update(invoiceRef(store, 'b'), { status: 'issued', sequence: 2, number: 'RESH-2026-002', issuedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  second.set(counterRef(store), { ownerUid: 'fictional-alice', lastValue: 2, lastInvoiceId: 'b', updatedAt: serverTimestamp() });
  await assertFails(second.commit());
  const ok = writeBatch(store);
  ok.update(invoiceRef(store, 'b'), { status: 'issued', sequence: 2, number: 'RESH-2027-002', issuedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  ok.set(counterRef(store), { ownerUid: 'fictional-alice', lastValue: 2, lastInvoiceId: 'b', updatedAt: serverTimestamp() });
  await assertSucceeds(ok.commit());
  // A draft can never be created already numbered.
  await assertFails(setDoc(invoiceRef(store, 'c'), draft({ number: 'RESH-2026-003' })));
});
