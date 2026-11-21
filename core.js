'use strict';
/* Reshwin Invoice Studio — pure, dependency-free business rules shared by the browser app and tests.
   Nothing here touches the network, Firebase, localStorage or the DOM. All inputs are untrusted. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InvoiceCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SCHEMA_VERSION = 1;
  const LIMITS = { name: 200, address: 2000, short: 200, type: 40, description: 4000, maxPaise: 10000000000, maxSequence: 999999999 };
  const TAX_RATES = [0, 5, 12, 18, 28];
  const STATUSES = ['draft', 'issued', 'paid', 'void'];
  const TRANSITIONS = { draft: ['issued'], issued: ['paid', 'void'], paid: [], void: [] };
  const RE = {
    pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    gstin: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/,
    ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
    account: /^\d{6,20}$/,
    safeId: /^[A-Za-z0-9_-]{1,128}$/,
    date: /^\d{4}-\d{2}-\d{2}$/,
    number: /^RESH-(\d{4})-(\d{3,9})$/,
    email: /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/
  };
  const blankFrom = () => ({ name: '', addr: '', pan: '', type: '', bank: '', branch: '', acc: '', ifsc: '' });
  const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));

  function validDate(s) {
    if (typeof s !== 'string' || !RE.date.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return y > 0 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  // Invoice number format preserved from the existing app: RESH-<invoice year>-<per-account sequence, min 3 digits>.
  function formatNumber(date, sequence) {
    if (!validDate(date)) throw new Error('Invalid invoice date');
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > LIMITS.maxSequence) throw new Error('Invalid sequence');
    return 'RESH-' + date.slice(0, 4) + '-' + String(sequence).padStart(3, '0');
  }
  function sequenceFromNumber(no) {
    const m = RE.number.exec(str(no));
    return m ? Number(m[2]) : 0;
  }
  function parseAmount(s) {
    s = str(s).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0 || n > LIMITS.maxPaise / 100) return null;
    return Math.round(n * 100);
  }
  // Integer half-up GST. Matches the Firestore rule's tolerance window exactly.
  function taxFor(amountPaise, rate) { return Math.floor((amountPaise * rate + 50) / 100); }

  function validateSender(f) {
    f = { ...blankFrom(), ...f };
    const out = { name: str(f.name).trim(), addr: str(f.addr).trim(), pan: str(f.pan).trim().toUpperCase(), type: str(f.type).trim(),
      bank: str(f.bank).trim(), branch: str(f.branch).trim(), acc: str(f.acc).trim(), ifsc: str(f.ifsc).trim().toUpperCase() };
    if (!out.name || !out.addr) return { error: 'Enter your name and address' };
    if (out.name.length > LIMITS.name || out.addr.length > LIMITS.address) return { error: 'Name or address is too long' };
    if (out.type.length > LIMITS.type || out.bank.length > LIMITS.short || out.branch.length > LIMITS.short) return { error: 'A bank field is too long' };
    if (out.pan && !RE.pan.test(out.pan)) return { error: 'Check the PAN format' };
    if (out.ifsc && !RE.ifsc.test(out.ifsc)) return { error: 'Check IFSC format' };
    if (out.acc && !RE.account.test(out.acc)) return { error: 'Check bank account number' };
    return { value: out };
  }
  function validateClient(c) {
    const out = { name: str(c?.name).trim(), addr: str(c?.addr).trim(), pan: str(c?.pan).trim().toUpperCase(), gstin: str(c?.gstin).trim().toUpperCase() };
    if (!out.name) return { error: 'Enter a client name' };
    if (out.name.length > LIMITS.name || out.addr.length > LIMITS.address) return { error: 'Client name or address is too long' };
    if (out.pan && !RE.pan.test(out.pan)) return { error: 'Check client PAN' };
    if (out.gstin && !RE.gstin.test(out.gstin)) return { error: 'Check GSTIN' };
    if (out.pan && out.gstin && out.gstin.slice(2, 12) !== out.pan) return { error: 'Client GSTIN must match client PAN' };
    return { value: out };
  }
  function validateInvoiceInput(i) {
    const amountPaise = parseAmount(i.amount);
    if (amountPaise === null) return { error: 'Enter an amount with up to 2 decimal places' };
    const reg = str(i.reg).trim();
    if (!reg) return { error: 'Describe the work' };
    if (reg.length > LIMITS.description) return { error: 'Description is too long' };
    if (!validDate(i.date)) return { error: 'Choose a valid invoice date' };
    const taxRate = Number(i.taxRate);
    if (!TAX_RATES.includes(taxRate)) return { error: 'Choose a valid tax rate' };
    if (!RE.safeId.test(str(i.clientId))) return { error: 'Select a client' };
    const taxPaise = taxFor(amountPaise, taxRate);
    return { value: { reg, date: i.date, clientId: i.clientId, amountPaise, taxRate, taxPaise, totalPaise: amountPaise + taxPaise } };
  }
  function canTransition(from, to) { return (TRANSITIONS[from] || []).includes(to); }

  /* ---- UI shape <-> Firestore document shape (no server fields here; the data layer adds ownerUid/timestamps) ---- */
  const senderToDoc = f => ({ name: f.name, address: f.addr, pan: f.pan, bankName: f.bank, bankBranch: f.branch, accountNumber: f.acc, accountType: f.type, ifsc: f.ifsc });
  const senderFromDoc = d => ({ name: str(d?.name), addr: str(d?.address), pan: str(d?.pan), type: str(d?.accountType), bank: str(d?.bankName), branch: str(d?.bankBranch), acc: str(d?.accountNumber), ifsc: str(d?.ifsc) });
  const clientToDoc = c => ({ name: c.name, address: c.addr, pan: c.pan, gstin: c.gstin });
  const clientFromDoc = (id, d) => ({ id, name: str(d?.name), addr: str(d?.address), pan: str(d?.pan), gstin: str(d?.gstin) });
  const iso = t => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : t instanceof Date ? t.toISOString() : null);
  function invoiceFromDoc(id, d) {
    return {
      id, no: str(d.number), sequence: d.sequence || 0, date: str(d.date), clientId: str(d.clientId),
      client: clientFromDoc(d.clientId, d.clientSnapshot), from: senderFromDoc(d.senderSnapshot), reg: str(d.description),
      amountPaise: d.amountPaise, taxRate: d.taxRate, taxPaise: d.taxPaise, totalPaise: d.totalPaise, status: d.status,
      createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt), issuedAt: iso(d.issuedAt), paidAt: iso(d.paidAt), voidedAt: iso(d.voidedAt),
      updateToken: d.updatedAt && typeof d.updatedAt.toMillis === 'function' ? d.updatedAt.toMillis() : null
    };
  }
  // Draft body written to Firestore. `status:'draft'` and an empty number are enforced again by the rules.
  function draftToDoc(input, client, sender) {
    return {
      schemaVersion: SCHEMA_VERSION, status: 'draft', sequence: 0, number: '', date: input.date, currency: 'INR',
      description: input.reg, clientId: client.id, clientSnapshot: clientToDoc(client), senderSnapshot: senderToDoc(sender),
      amountPaise: input.amountPaise, taxRate: input.taxRate, taxPaise: input.taxPaise, totalPaise: input.totalPaise,
      issuedAt: null, paidAt: null, voidedAt: null
    };
  }

  /* ---- Legacy browser-data migration planning (dry run only; performs no writes) ---- */
  function checksum(text) { // FNV-1a 32-bit: an integrity label for the backup file, not a security feature.
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  function legacyStatus(inv) { return STATUSES.includes(inv?.status) ? inv.status : 'issued'; }
  function planMigration(legacy, opts = {}) {
    const errors = [], warnings = [];
    const existing = opts.existing || { clients: [], invoices: [], lastSequence: 0 };
    if (!legacy || typeof legacy !== 'object' || !Array.isArray(legacy.clients) || !Array.isArray(legacy.invoices)) {
      return { ok: false, errors: ['The browser data is not a valid Invoice Studio data set.'], warnings, summary: null };
    }
    const sender = legacy.from && (legacy.from.name || legacy.from.addr) ? validateSender(legacy.from) : null;
    if (sender && sender.error) errors.push('Sender details: ' + sender.error);
    const clientKey = c => [c.name, c.addr, c.pan, c.gstin].map(x => str(x).trim().toLowerCase()).join('|');
    const existingClientKeys = new Set(existing.clients.map(clientKey));
    const seenClientIds = new Set(), importClients = [], skippedClients = [];
    legacy.clients.forEach((c, i) => {
      const v = validateClient(c);
      if (v.error) { errors.push('Client #' + (i + 1) + ': ' + v.error); return; }
      if (!RE.safeId.test(str(c.id))) { errors.push('Client #' + (i + 1) + ': unusable id'); return; }
      if (seenClientIds.has(c.id)) { errors.push('Client #' + (i + 1) + ': duplicate id'); return; }
      seenClientIds.add(c.id);
      if (existingClientKeys.has(clientKey(v.value))) { skippedClients.push(c.id); warnings.push('Client "' + v.value.name + '" already exists in this account and would be skipped.'); return; }
      importClients.push({ id: c.id, ...v.value });
    });
    const existingNumbers = new Set(existing.invoices.map(x => x.no).filter(Boolean));
    const existingIds = new Set(existing.invoices.map(x => x.id));
    const seenIds = new Set(), seenNumbers = new Set(), importInvoices = [], skippedInvoices = [];
    let maxSeq = 0;
    legacy.invoices.forEach((inv, i) => {
      const tag = 'Invoice #' + (i + 1) + (inv && inv.no ? ' (' + inv.no + ')' : '');
      if (!inv || typeof inv !== 'object') { errors.push(tag + ': not an object'); return; }
      if (!RE.safeId.test(str(inv.id))) { errors.push(tag + ': unusable id'); return; }
      if (seenIds.has(inv.id)) { errors.push(tag + ': duplicate id'); return; }
      seenIds.add(inv.id);
      if (existingIds.has(inv.id)) { skippedInvoices.push(inv.id); warnings.push(tag + ' already exists in this account and would be skipped.'); return; }
      const status = legacyStatus(inv);
      const m = RE.number.exec(str(inv.no));
      if (!m) { errors.push(tag + ': number is not in RESH-YYYY-NNN format'); return; }
      if (seenNumbers.has(inv.no) || existingNumbers.has(inv.no)) { errors.push(tag + ': duplicate invoice number'); return; }
      seenNumbers.add(inv.no);
      if (!validDate(inv.date)) { errors.push(tag + ': invalid date'); return; }
      if (m[1] !== inv.date.slice(0, 4)) warnings.push(tag + ': number year differs from invoice date year.');
      const total = inv.totalPaise ?? inv.amountPaise;
      if (!Number.isInteger(inv.amountPaise) || inv.amountPaise <= 0 || inv.amountPaise > LIMITS.maxPaise) { errors.push(tag + ': invalid amount'); return; }
      const rate = Number(inv.taxRate ?? 0), tax = inv.taxPaise ?? 0;
      if (!TAX_RATES.includes(rate) || !Number.isInteger(tax) || tax !== taxFor(inv.amountPaise, rate) || total !== inv.amountPaise + tax) { errors.push(tag + ': tax or total does not add up'); return; }
      const cv = validateClient(inv.client), sv = validateSender(inv.from);
      if (cv.error || sv.error) { errors.push(tag + ': ' + (cv.error || sv.error)); return; }
      if (!str(inv.reg).trim() || str(inv.reg).length > LIMITS.description) { errors.push(tag + ': description missing or too long'); return; }
      maxSeq = Math.max(maxSeq, Number(m[2]));
      importInvoices.push({ id: inv.id, no: inv.no, status, sequence: Number(m[2]) });
    });
    const gaps = [];
    const seqs = new Set(importInvoices.filter(x => x.status !== 'draft').map(x => x.sequence));
    for (let n = 1; n <= maxSeq; n++) if (!seqs.has(n)) gaps.push(n);
    if (gaps.length) warnings.push('Historical numbering has gaps at: ' + gaps.slice(0, 10).join(', ') + (gaps.length > 10 ? '…' : '') + '. Gaps will be kept, not renumbered.');
    const nextSequence = Math.max(maxSeq, existing.lastSequence || 0) + 1;
    const backupBody = JSON.stringify({ version: 2, exportedAt: opts.now || null, from: legacy.from || null, clients: legacy.clients, invoices: legacy.invoices, seq: legacy.seq });
    const batchId = 'import-' + checksum(backupBody);
    return {
      ok: errors.length === 0, errors, warnings,
      summary: { clients: importClients.length, skippedClients: skippedClients.length, invoices: importInvoices.length, skippedInvoices: skippedInvoices.length, hasSender: !!sender, highestHistoricalSequence: maxSeq, nextSequenceAfterImport: nextSequence },
      backup: { fileName: 'invoice-studio-pre-migration-backup-' + batchId + '.json', checksum: checksum(backupBody), body: backupBody },
      rollback: { batchId, deletes: importInvoices.map(x => 'invoices/' + x.id).concat(importClients.map(x => 'clients/' + x.id)),
        note: 'Rollback removes only documents created by this batch. The browser copy is never modified or deleted by migration.' },
      importClients, importInvoices
    };
  }

  return { SCHEMA_VERSION, LIMITS, TAX_RATES, STATUSES, RE, blankFrom, validDate, formatNumber, sequenceFromNumber, parseAmount, taxFor,
    validateSender, validateClient, validateInvoiceInput, canTransition, senderToDoc, senderFromDoc, clientToDoc, clientFromDoc,
    invoiceFromDoc, draftToDoc, checksum, legacyStatus, planMigration };
});
