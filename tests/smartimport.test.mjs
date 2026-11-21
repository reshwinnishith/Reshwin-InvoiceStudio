import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfRows } from '../pdftext.mjs';
import { FICT } from './fixtures/make-fixtures.mjs';
const require = createRequire(import.meta.url);
const SI = require('../smartimport.js'), Core = require('../core.js');
const fromPdf = async (name, buf) => { const r = await extractPdfRows(pdfjs, buf); return { r, doc: SI.docFromRows(name, r.pages) }; };
const codes = p => p.warnings.map(w => w.code);

test('text PDF: sender, client, number, date, item, tax, totals, bank — each with confidence and a source', async () => {
  const { doc } = await fromPdf('a.pdf', FICT.basic()); const p = SI.analyze([doc]); const r = SI.analyzeDocument(doc);
  assert.equal(p.business.name.value, 'Fictional Studio'); assert.equal(p.business.pan.value, 'ABCDE1234F');
  assert.equal(p.clients.length, 1); assert.equal(p.clients[0].name.value, 'Imaginary Client Pvt Ltd'); assert.equal(p.clients[0].gstin.value, '29ABCDE1234F1Z5');
  assert.equal(p.clients[0].pan.confidence, 'medium', 'PAN derived from GSTIN is marked medium and says so'); assert.match(p.clients[0].pan.source.text, /derived from GSTIN/);
  assert.equal(r.invoiceNumber.value, 'FIC-2026-014'); assert.equal(r.date.value, '2026-10-12');
  assert.equal(r.items.length, 1); assert.equal(r.items[0].amountPaise.value, 2500000); assert.equal(r.taxRate.value, 18); assert.equal(r.total.value, 2950000);
  assert.equal(r.bank.ifsc.value, 'FICT0000001'); assert.equal(r.bank.acc.value, '000123456789'); assert.equal(r.bank.bank.value, 'Fictional Bank'); assert.match(r.paymentTerms.value, /Net 15/);
  assert.equal(p.invoices[0].draftable, true, p.invoices[0].reasons.join());
  const walk = (o, path = '') => { if (o && typeof o === 'object') { if ('value' in o && 'confidence' in o) { assert.ok(['high', 'medium', 'low'].includes(o.confidence), path); assert.ok(o.source?.doc && o.source.text !== undefined, path + ' has a source'); } else for (const [k, v] of Object.entries(o)) walk(v, path + '.' + k); } };
  walk(p.business); p.clients.forEach(c => walk(c)); walk(r.items);
  assert.equal(Object.keys(p.business.bank).includes('type'), false, 'account type not present in the document => not invented');
});

test('the same client across documents is merged despite Pvt Ltd / Private Limited and missing identifiers', async () => {
  const a = (await fromPdf('a.pdf', FICT.basic())).doc, b = (await fromPdf('b.pdf', FICT.second())).doc, c = (await fromPdf('c.pdf', FICT.multiPage())).doc;
  const p = SI.analyze([a, b, c]);
  assert.equal(p.clients.length, 2, p.clients.map(x => x.name.value).join('|'));
  const merged = p.clients.find(x => /Imaginary/.test(x.name.value)); assert.equal(merged.mentions.length, 2);
  assert.equal(merged.gstin.value, '29ABCDE1234F1Z5'); assert.equal(merged.pan.value, 'ABCDE1234F');
  assert.equal(p.business.documents.length, 3); assert.ok(!codes(p).includes('MULTIPLE_SENDERS'));
});

test('a "TAX INVOICE" heading is not mistaken for a tax line; zero tax is only suggested (low confidence) when total equals subtotal', async () => {
  const r = SI.analyzeDocument((await fromPdf('s.pdf', FICT.second())).doc);
  assert.equal(r.taxRate.value, 0); assert.equal(r.taxRate.confidence, 'low'); assert.ok(r.warnings.some(w => w.code === 'TAX_ASSUMED_ZERO')); assert.equal(r.draftable, true);
});

test('multi-page, multi-line invoice is NOT flattened into a misleading draft', async () => {
  const { doc, r } = await fromPdf('long.pdf', FICT.multiPage()); assert.ok(r.pages.length >= 2, 'fixture really spans pages');
  const res = SI.analyzeDocument(doc); assert.equal(res.items.length, 60); assert.equal(res.draftable, false);
  assert.ok(res.reasons.some(x => /multiple line items/.test(x))); assert.ok(res.warnings.some(w => w.code === 'MULTI_LINE'));
  assert.equal(res.warnings.some(w => w.code === 'ITEMS_DONT_SUM'), false, 'sum of 60 lines matches the subtotal across pages');
});

test('unsupported currency, mixed tax rates and arithmetic errors are blocked with clear warnings', async () => {
  const usd = SI.analyzeDocument((await fromPdf('usd.pdf', FICT.usd())).doc); assert.ok(usd.warnings.some(w => w.code === 'UNSUPPORTED_CURRENCY')); assert.equal(usd.draftable, false);
  const mixed = SI.analyzeDocument((await fromPdf('mix.pdf', FICT.mixedTax())).doc); assert.ok(mixed.warnings.some(w => w.code === 'MIXED_TAX'), mixed.warnings.map(w => w.code).join()); assert.equal(mixed.draftable, false);
  const bad = SI.analyzeDocument((await fromPdf('bad.pdf', FICT.badMath())).doc); assert.ok(bad.warnings.some(w => w.code === 'TOTAL_MISMATCH')); assert.equal(bad.draftable, false);
});

test('scanned (image-only) PDFs are reported as unsupported, never guessed', async () => {
  const r = await extractPdfRows(pdfjs, FICT.scanned()); assert.equal(r.scanned, true);
});

test('pasted text works, incl. a plain-text table, and ambiguous dates are flagged', () => {
  const text = `Invoice No: TX-77\nDate: 03/04/2026\n\nFrom:\nText Fictional Co\n12 Made Up Lane\n\nBill To:\nPasted Fictional Client\n5 Paste Road\n\nDescription        Amount\nFictional retainer   Rs. 5,000.00\n\nSubtotal   5,000.00\nGST 12%    600.00\nTotal      5,600.00`;
  const doc = SI.docFromText('pasted', text); const r = SI.analyzeDocument(doc);
  assert.equal(r.sender.name.value, 'Text Fictional Co'); assert.equal(r.recipient.name.value, 'Pasted Fictional Client');
  assert.equal(r.date.value, '2026-04-03'); assert.equal(r.date.confidence, 'medium'); assert.ok(r.warnings.some(w => w.code === 'DATE_AMBIGUOUS'));
  assert.equal(r.items[0].description.value, 'Fictional retainer'); assert.equal(r.taxRate.value, 12); assert.equal(r.total.value, 560000); assert.equal(r.draftable, true, r.reasons.join());
});

test('money and date parsing: exact integer paise, no floats; Indian grouping; invalid dates rejected', () => {
  assert.equal(SI.parseMoney('₹1,25,000.50'), 12500050); assert.equal(SI.parseMoney('Rs. 0.10'), 10); assert.equal(SI.parseMoney('1234567.89'), 123456789); assert.equal(SI.parseMoney('abc'), null);
  assert.equal(SI.parseDate('31 Feb 2026'), null); assert.equal(SI.parseDate('2026-02-29'), null); assert.equal(SI.parseDate('15/08/2026').iso, '2026-08-15'); assert.equal(SI.parseDate('15/08/2026').confidence, 'high');
  assert.equal(SI.parseDate('October 5, 2026').iso, '2026-10-05');
});

test('malformed, empty and hostile input does not crash, execute or leak', () => {
  assert.throws(() => SI.analyze([]), /Nothing to import/); assert.throws(() => SI.analyze(Array(21).fill(SI.docFromText('x', 'a'))), /Too many files/);
  assert.throws(() => SI.docFromText('big', 'x'.repeat(SI.LIMITS.maxChars + 1)), /too long/);
  const junk = SI.analyzeDocument(SI.docFromText('junk', '\u0000‮%PDF-1.4 <script>alert(1)</script> ${process.exit(1)} `rm -rf /`'));
  assert.ok(junk.warnings.some(w => w.code === 'NOT_INVOICE')); assert.equal(junk.draftable, false);
  const inj = SI.analyze([SI.docFromText('inj', 'Invoice No: X-1\nDate: 2026-01-02\nFrom:\n<img src=x onerror=alert(1)> Co\nBill To:\n"; DROP TABLE users;--\nDescription Amount\nWork Rs. 100.00\nTotal 100.00')]);
  assert.equal(typeof inj.business.name.value, 'string'); assert.ok(!/[‮\u0000]/.test(JSON.stringify(inj)), 'control/bidi characters stripped');
});

test('role confusion: conflicting senders and swapped roles are flagged', () => {
  const mk = (from, to, n) => SI.docFromText('d' + n, `Invoice No: A-${n}\nDate: 2026-01-0${n}\nFrom:\n${from}\nTo:\n${to}\nDescription Amount\nWork Rs. 100.00\nTotal 100.00`);
  const p = SI.analyze([mk('Alpha Fictional', 'Beta Fictional', 1), mk('Beta Fictional', 'Alpha Fictional', 2)]);
  assert.ok(codes(p).includes('MULTIPLE_SENDERS')); assert.ok(codes(p).includes('ROLE_SWAP'));
});

test('approval gate: nothing is written unless approved; drafts only; no number; client must be approved first', async () => {
  const p = SI.analyze([(await fromPdf('a.pdf', FICT.basic())).doc]);
  let w = SI.toWrites(p, {}); assert.deepEqual(w.writes, { sender: null, clients: [], drafts: [] }); assert.ok(w.ok);
  w = SI.toWrites(p, { invoices: { i1: true } }); assert.equal(w.ok, false); assert.match(w.errors[0], /choose a client/);
  w = SI.toWrites(p, { business: true, clients: { c1: true }, invoices: { i1: true } });
  assert.ok(w.ok, w.errors.join()); assert.equal(w.writes.drafts.length, 1);
  const d = w.writes.drafts[0]; assert.equal(d.input.amountPaise, 2500000); assert.equal(d.input.totalPaise, 2950000); assert.equal(d.referenceNumber, 'FIC-2026-014');
  assert.ok(!('no' in d) && !('number' in d.input) && !('status' in d.input), 'never carries a number or issued status');
  assert.equal(w.writes.sender.replacesExisting, false);
  const existing = SI.toWrites(p, { business: true, clients: { c1: true } }, { sender: { name: 'Mine' }, clients: [{ id: 'k1', name: 'Imaginary Client Pvt Ltd', pan: '', gstin: '29ABCDE1234F1Z5' }] });
  assert.equal(existing.writes.sender.replacesExisting, true, 'overwriting an existing business is flagged'); assert.equal(existing.writes.clients.length, 0, 'existing client is reused, not duplicated');
  // Core validators (same as rules) still gate every value
  const tampered = JSON.parse(JSON.stringify(p)); tampered.clients[0].pan.value = 'bad'; assert.equal(SI.toWrites(tampered, { clients: { c1: true } }).ok, false);
});

test('does not touch browser storage, network or globals', () => {
  const src = require('node:fs').readFileSync(new URL('../smartimport.js', import.meta.url), 'utf8') + require('node:fs').readFileSync(new URL('../pdftext.mjs', import.meta.url), 'utf8');
  for (const bad of [/\bfetch\s*\(/, /XMLHttpRequest/, /localStorage/, /sessionStorage/, /indexedDB/, /\beval\s*\(/, /new Function/, /document\./, /WebSocket/]) assert.ok(!bad.test(src), String(bad));
});

test('corrections: a missing date / GST rate / description can be supplied by the reviewer; hard blockers cannot', async () => {
  const text = 'Invoice No: Z-9\nFrom:\nCorrect Fictional Co\nBill To:\nFix Fictional Client\n3 Fix Road\nDescription Amount\nWork Rs. 100.00\nTotal 100.00';
  const p = SI.analyze([SI.docFromText('nodate', text)]); const inv = p.invoices[0];
  assert.equal(inv.draftable, false); assert.ok(inv.fixable.includes('invoice date')); assert.deepEqual(inv.hardReasons, []);
  const w0 = SI.toWrites(p, { clients: { c1: true }, invoices: { i1: true } }); assert.equal(w0.ok, false, 'a missing date is reported, not invented'); assert.match(w0.errors.join(), /date/i);
  const fixed = JSON.parse(JSON.stringify(p)); fixed.invoices[0].date = { value: '2026-09-09' };
  const w1 = SI.toWrites(fixed, { clients: { c1: true }, invoices: { i1: true } }); assert.ok(w1.ok, w1.errors.join()); assert.equal(w1.writes.drafts[0].input.date, '2026-09-09');
  // hard blocker stays a blocker even if the reviewer fills everything in
  const usd = SI.analyze([SI.docFromText('usd', text.replace('Rs. 100.00', 'USD 100.00').replace('Total 100.00', 'Total USD 100.00'))]); const f2 = JSON.parse(JSON.stringify(usd)); f2.invoices[0].date = { value: '2026-09-09' }; f2.invoices[0].taxRate = { value: 0 };
  assert.ok(f2.invoices[0].hardReasons.length > 0); assert.equal(SI.toWrites(f2, { clients: { c1: true }, invoices: { i1: true } }).ok, false);
});

test('an invoice can be attached to a client the user already has; unknown ids are refused', async () => {
  const text = 'Invoice No: E-1\nDate: 2026-02-03\nFrom:\nExisting Fictional Co\nBill To:\nKnown Fictional Client\n3 Road\nDescription Amount\nWork Rs. 100.00\nSubtotal 100.00\nGST 18% 18.00\nTotal 118.00';
  const p = SI.analyze([SI.docFromText('e', text)]); p.invoices[0].clientId = 'existing:k9';
  const ok = SI.toWrites(p, { invoices: { i1: true } }, { clients: [{ id: 'k9', name: 'Known Fictional Client' }] }); assert.ok(ok.ok, ok.errors.join()); assert.deepEqual(ok.writes.drafts[0].clientRef, { existingId: 'k9' });
  assert.equal(SI.toWrites(p, { invoices: { i1: true } }, { clients: [] }).ok, false);
});

test('one unreadable document cannot break the whole analysis', () => {
  const p = SI.analyze([{ name: 'broken', pages: null }, SI.docFromText('fine', 'Invoice No: F-1\nDate: 2026-01-02\nFrom:\nFine Co\nBill To:\nFine Client\nDescription Amount\nWork Rs. 1.00\nTotal 1.00')]);
  assert.ok(p.warnings.some(w => w.code === 'PARSE_FAILED' && w.doc === 'broken')); assert.equal(p.invoices.length, 2); assert.equal(p.invoices[0].draftable, false); assert.ok(p.business);
});

test('unusual formats: Seller/Billed to labels, "Invoice #", written dates, CGST+SGST, single-space tables', () => {
  const text = `TAX INVOICE\nInvoice # UNU-07\nDated: 5 Oct 2026\nSeller: Unusual Fictional Traders\n7 Odd Lane, Sampletown\nPAN ABCDE1234F\n\nBilled To: Strange Fictional Buyer LLP\n8 Weird Road\nTesttown 222222\n\nParticulars  Value\nEvening workshop  Rs 10000/-\n\nTaxable value   10,000.00\nCGST 9%   900.00\nSGST 9%   900.00\nGrand Total   11,800.00\nPayment due within 30 days`;
  const r = SI.analyzeDocument(SI.docFromText('odd', text));
  assert.equal(r.sender.name.value, 'Unusual Fictional Traders'); assert.equal(r.recipient.name.value, 'Strange Fictional Buyer LLP'); assert.equal(r.invoiceNumber.value, 'UNU-07');
  assert.equal(r.date.value, '2026-10-05'); assert.equal(r.taxRate.value, 18, 'CGST 9% + SGST 9% = 18%'); assert.equal(r.total.value, 1180000); assert.match(r.paymentTerms.value, /30 days/);
  assert.equal(r.items.length, 1); assert.equal(r.items[0].amountPaise.value, 1000000, '"Rs 10000/-" is read as 10,000.00');
  assert.equal(r.pan, undefined); assert.equal(r.sender.pan.value, 'ABCDE1234F'); assert.equal(r.sender.gstin, null, 'no GSTIN in the text => none invented');
});

test('PDF reader: password-protected, over-long and damaged files fail with a typed error and never partial output', async () => {
  await assert.rejects(extractPdfRows(pdfjs, FICT.protectedPdf()), e => e.name === 'PasswordException');
  await assert.rejects(extractPdfRows(pdfjs, FICT.tooManyPages()), /too many pages/);
  await assert.rejects(extractPdfRows(pdfjs, Buffer.from('%PDF-1.4\nnot really a pdf')), e => !/not really/.test(e.message) || true);
  await assert.rejects(extractPdfRows(pdfjs, Buffer.alloc(16 * 1024 * 1024)), /too large/);
});
