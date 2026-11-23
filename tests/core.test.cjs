const assert = require('node:assert/strict');
const C = require('../core.js');
// number format preserved from the existing app
assert.equal(C.formatNumber('2026-11-20', 1), 'RESH-2026-001');
assert.equal(C.formatNumber('2027-01-02', 42), 'RESH-2027-042');
assert.equal(C.formatNumber('2026-11-20', 1234), 'RESH-2026-1234');
assert.throws(() => C.formatNumber('2026-02-30', 1)); assert.throws(() => C.formatNumber('2026-01-01', 0)); assert.throws(() => C.formatNumber('2026-01-01', 1.5));
assert.equal(C.sequenceFromNumber('RESH-2026-007'), 7); assert.equal(C.sequenceFromNumber('RIS-7'), 0); assert.equal(C.sequenceFromNumber(null), 0);
// money
assert.equal(C.parseAmount('25000.50'), 2500050); assert.equal(C.parseAmount('0'), null); assert.equal(C.parseAmount('1e3'), null);
assert.equal(C.parseAmount('12.345'), null); assert.equal(C.parseAmount('-5'), null); assert.equal(C.parseAmount('100000000.01'), null); assert.equal(C.parseAmount('100000000'), 10000000000);
assert.equal(C.taxFor(10000, 18), 1800); assert.equal(C.taxFor(1, 5), 0); assert.equal(C.taxFor(10, 5), 1); /* 0.5 rounds up */ assert.equal(C.taxFor(9, 5), 0);
assert.equal(C.taxFor(10000000000, 28), 2800000000);
// dates
for (const d of ['2024-02-29', '2026-12-31']) assert.ok(C.validDate(d));
for (const d of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-1-1', 'x', null, '0000-01-01']) assert.ok(!C.validDate(d), String(d));
// sender/client validation
assert.equal(C.validateSender({ name: 'A', addr: 'B', pan: 'abcde1234f', ifsc: 'abcd0123456', acc: '123456' }).value.pan, 'ABCDE1234F');
assert.ok(C.validateSender({ name: '', addr: 'B' }).error); assert.ok(C.validateSender({ name: 'A', addr: 'B', acc: '12' }).error);
assert.ok(C.validateSender({ name: 'A'.repeat(201), addr: 'B' }).error);
assert.ok(C.validateClient({ name: 'C', pan: 'ABCDE1234F', gstin: '29ZZZZZ9999Z1Z5' }).error, 'GSTIN/PAN mismatch');
assert.ok(C.validateClient({ name: 'C', pan: 'ABCDE1234F', gstin: '29ABCDE1234F1Z5' }).value);
// invoice input
const ok = C.validateInvoiceInput({ amount: '100.00', reg: 'Work', date: '2026-11-20', taxRate: '18', clientId: 'c-1' });
assert.deepEqual(ok.value, { reg: 'Work', date: '2026-11-20', clientId: 'c-1', amountPaise: 10000, taxRate: 18, taxPaise: 1800, totalPaise: 11800 });
for (const bad of [{ amount: 'x' }, { reg: ' ' }, { date: '2026-02-30' }, { taxRate: '7' }, { clientId: '../x' }, { reg: 'a'.repeat(4001) }])
  assert.ok(C.validateInvoiceInput({ amount: '1', reg: 'r', date: '2026-01-01', taxRate: 0, clientId: 'c', ...bad }).error, JSON.stringify(bad));
// state machine
assert.ok(C.canTransition('draft', 'issued')); assert.ok(C.canTransition('issued', 'paid')); assert.ok(C.canTransition('issued', 'void'));
for (const [a, b] of [['draft', 'paid'], ['paid', 'void'], ['void', 'issued'], ['issued', 'draft'], ['paid', 'issued']]) assert.ok(!C.canTransition(a, b), a + b);
// mappers round trip
const s = { name: 'N', addr: 'A', pan: '', type: 'Savings', bank: 'B', branch: 'Br', acc: '123456', ifsc: '' };
assert.deepEqual(C.senderFromDoc(C.senderToDoc(s)), s);
const cl = { id: 'c1', name: 'N', addr: 'A', pan: '', gstin: '' };
assert.deepEqual(C.clientFromDoc('c1', C.clientToDoc(cl)), cl);

/* ---- migration planner ---- */
const from = { name: 'Fictional Sender', addr: 'Example City', pan: '', type: 'Savings', bank: 'Bank', branch: 'Br', acc: '123456', ifsc: '' };
const client = { id: 'c1', name: 'Fictional Client', addr: 'Addr', pan: '', gstin: '' };
const mk = (n, over = {}) => ({ id: 'i' + n, no: C.formatNumber('2026-11-20', n), date: '2026-11-20', clientId: 'c1', client, from, reg: 'Work', amountPaise: 10000, taxRate: 0, taxPaise: 0, totalPaise: 10000, status: 'issued', ...over });
let plan = C.planMigration({ from, clients: [client], invoices: [mk(1), mk(2, { status: 'paid' }), mk(4, { status: undefined })], seq: 5 });
assert.ok(plan.ok, plan.errors.join());
assert.equal(plan.summary.invoices, 3); assert.equal(plan.summary.highestHistoricalSequence, 4); assert.equal(plan.summary.nextSequenceAfterImport, 5);
assert.ok(plan.warnings.some(w => /gaps at: 3/.test(w)), 'reports numbering gap without renumbering');
assert.equal(plan.importInvoices.find(x => x.id === 'i4').status, 'issued', 'legacy invoices without status are treated as issued');
assert.equal(plan.rollback.deletes.length, 4); assert.ok(plan.backup.body.includes('Fictional Client'));
assert.equal(plan.backup.checksum, C.checksum(plan.backup.body));
assert.deepEqual(C.planMigration({ from, clients: [client], invoices: [mk(1), mk(2, { status: 'paid' }), mk(4, { status: undefined })], seq: 5 }).rollback.batchId, plan.rollback.batchId, 'batch id deterministic');
// rejects: duplicates, bad numbers, bad totals, bad ids, tampering
assert.ok(!C.planMigration({ from, clients: [client], invoices: [mk(1), mk(1, { id: 'other' })] }).ok, 'duplicate number');
assert.ok(!C.planMigration({ from, clients: [client], invoices: [mk(1), mk(2, { id: 'i1' })] }).ok, 'duplicate id');
assert.ok(!C.planMigration({ from, clients: [client], invoices: [mk(1, { no: 'RIS-1' })] }).ok, 'foreign number format');
assert.ok(!C.planMigration({ from, clients: [client], invoices: [mk(1, { totalPaise: 9 })] }).ok, 'bad total');
assert.ok(!C.planMigration({ from, clients: [client], invoices: [mk(1, { id: '../../x' })] }).ok, 'unsafe id');
assert.ok(!C.planMigration({ from, clients: [client], invoices: [mk(1, { date: '2026-02-30' })] }).ok, 'bad date');
assert.ok(!C.planMigration({ clients: 'x', invoices: [] }).ok, 'garbage input');
assert.ok(!C.planMigration(null).ok);
// duplicates against existing cloud data are skipped with warnings (or rejected for number clashes)
plan = C.planMigration({ from, clients: [client], invoices: [mk(1)] }, { existing: { clients: [client], invoices: [{ id: 'i1', no: 'RESH-2026-001' }], lastSequence: 9 } });
assert.equal(plan.summary.skippedClients, 1); assert.equal(plan.summary.skippedInvoices, 1); assert.equal(plan.summary.nextSequenceAfterImport, 10);
plan = C.planMigration({ from, clients: [client], invoices: [mk(1)] }, { existing: { clients: [], invoices: [{ id: 'zzz', no: 'RESH-2026-001' }], lastSequence: 1 } });
assert.ok(!plan.ok, 'number collision with live data blocks import');
// A high historical number must not allocate or scan a billion gaps.
const started=Date.now();const sparse=C.planMigration({from,clients:[client],invoices:[mk(999999999)]});
assert.ok(sparse.ok);assert.ok(Date.now()-started<1000);assert.ok(sparse.warnings.some(w=>w.includes('1, 2, 3')));
assert.notEqual(C.timestampToken({seconds:100,nanoseconds:1000}),C.timestampToken({seconds:100,nanoseconds:2000}));
console.log('PASS: core business rules and migration planner');
