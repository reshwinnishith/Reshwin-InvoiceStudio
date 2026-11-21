'use strict';
/* Smart Import — LOCAL, rule-based extraction of business details, clients and a draft invoice from existing invoices.
   - No network, no AI/OCR service, no storage, no DOM. Pure functions; input text is untrusted and only ever returned as data.
   - Every suggested value carries {value, confidence, source}. Missing facts stay null — nothing is invented.
   - Output is a PROPOSAL. Nothing is written anywhere; toWrites() turns only explicitly approved items into validated drafts.
   Depends on core.js (InvoiceCore) for the same validators the app and the Firestore rules use. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.SmartImport = factory(root.InvoiceCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  const LIMITS = { maxDocs: 20, maxChars: 200000, maxRows: 4000, maxPages: 50 };
  const RE = {
    pan: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/, gstin: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/, ifsc: /\b[A-Z]{4}0[A-Z0-9]{6}\b/,
    money: /(?:₹|Rs\.?|INR)?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/
  };
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').replace(/[ \t]+/g, ' ').trim();
  const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|the)\b/g, ' ').replace(/\s+/g, ' ').trim();

  /* ---------- documents ---------- */
  // A document is { name, kind, tol, pages:[{page, rows:[[{x,text}]]}] }.
  function docFromText(name, text) {
    text = String(text || '');
    if (text.length > LIMITS.maxChars) throw new Error('Text is too long to import (limit ' + LIMITS.maxChars + ' characters).');
    const rows = text.replace(/\r\n?/g, '\n').split('\n').slice(0, LIMITS.maxRows).map(line => {
      const cells = []; const re = /\S(?:.*?\S)?(?=\s{3,}|\t|$)/g; let m;
      while ((m = re.exec(line.replace(/\t/g, '    ')))) cells.push({ x: m.index, text: clean(m[0]) });
      return cells;
    });
    return { name: clean(name) || 'pasted text', kind: 'text', tol: 3, pages: [{ page: 1, rows }] };
  }
  function docFromRows(name, pages) { return { name: clean(name), kind: 'pdf', tol: 14, pages }; }

  /* ---------- low-level parsing helpers (exported for tests) ---------- */
  function parseMoney(s) { // -> integer paise or null. No floating point.
    const m = /(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/.exec(String(s));
    if (!m) return null;
    const [whole, frac = ''] = m[1].replace(/,/g, '').split('.');
    const paise = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
    return Number.isSafeInteger(paise) ? paise : null;
  }
  function parseDate(s) {
    s = clean(s); let m;
    const ok = (y, mo, d, conf, note) => { const iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'); return Core.validDate(iso) ? { iso, confidence: conf, note } : null; };
    if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s))) return ok(+m[1], +m[2], +m[3], 'high');
    if ((m = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})\.?,?[\s\-]+(\d{4})\b/.exec(s))) { const mo = MONTHS.findIndex(x => x.startsWith(m[2].toLowerCase().slice(0, 3))) + 1; if (mo) return ok(+m[3], mo, +m[1], 'high'); }
    if ((m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(s))) { const mo = MONTHS.findIndex(x => x.startsWith(m[1].toLowerCase().slice(0, 3))) + 1; if (mo) return ok(+m[3], mo, +m[2], 'high'); }
    if ((m = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})\b/.exec(s))) {
      let y = +m[3]; const twoDigit = m[3].length === 2; if (twoDigit) y += 2000;
      const a = +m[1], b = +m[2], ambiguous = a <= 12 && b <= 12 && a !== b;
      const r = ok(y, b, a, ambiguous || twoDigit ? 'medium' : 'high', ambiguous ? 'Read as day/month/year; the month could be first.' : twoDigit ? 'Two-digit year assumed to be 20xx.' : undefined);
      return r;
    }
    return null;
  }
  function currencyOf(text) {
    const t = String(text);
    const found = new Set();
    if (/₹|\bRs\.?\s*\d|\bINR\b|\brupees?\b/i.test(t)) found.add('INR');
    if (/\bUSD\b|US\$|\$\s*\d/.test(t)) found.add('USD');
    if (/\bEUR\b|€/.test(t)) found.add('EUR');
    if (/\bGBP\b|£/.test(t)) found.add('GBP');
    return [...found];
  }
  function levenshtein(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  const similar = (a, b) => { if (!a || !b) return false; if (a === b) return true; const d = levenshtein(a, b); return 1 - d / Math.max(a.length, b.length) >= 0.88; };

  /* ---------- field finders ---------- */
  const allCells = doc => { const out = []; doc.pages.forEach(p => p.rows.forEach((row, r) => row.forEach((c, k) => out.push({ page: p.page, r, k, row, rows: p.rows, c })))); return out; };
  const snippet = t => clean(t).slice(0, 80);
  const mkField = (value, confidence, doc, page, text) => ({ value, confidence, source: { doc: doc.name, page, text: snippet(text) } });

  // value on the same cell after the label, else next cell in the row, else cell below in the same column
  function labelled(doc, labelRe, valueRe, { allowBelow = true } = {}) {
    for (const ctx of allCells(doc)) {
      const t = ctx.c.text; const m = labelRe.exec(t); if (!m) continue;
      const after = t.slice(m.index + m[0].length);
      let v = valueRe.exec(after); if (v) return { v, ctx, text: t };
      const next = ctx.row[ctx.k + 1]; if (next && (v = valueRe.exec(next.text))) return { v, ctx, text: t + ' ' + next.text };
      if (allowBelow) {
        for (let r = ctx.r + 1; r < Math.min(ctx.r + 3, ctx.rows.length); r++) {
          const below = ctx.rows[r].find(c => Math.abs(c.x - ctx.c.x) <= doc.tol + 6);
          if (below && (v = valueRe.exec(below.text))) return { v, ctx, text: t + ' ' + below.text };
          if (below) break;
        }
      }
    }
    return null;
  }

  const LABELS = {
    from: /^(?:bill(?:ed)?\s*from|from|seller|supplier|vendor|issued\s*by|service\s*provider|sold\s*by)\b\s*:?\s*/i,
    to: /^(?:bill(?:ed)?\s*to|invoice\s*to|billed\s*to|to|client|customer|buyer|sold\s*to|consignee)\b\s*:?\s*/i
  };
  const STOP = /^(?:invoice\s*(?:no|number|#|date)|date|due|s\.?\s*no|sl\.?\s*no|description|particulars|item|amount|qty|quantity|rate|bank|payment|terms|sub\s*-?total|total|grand|notes?|amount in words|bill(?:ed)?\s*(?:from|to)|from|to)\b/i;

  function blockAfter(doc, ctx, labelRe) {
    const lines = []; const first = clean(ctx.c.text.replace(labelRe, ''));
    if (first) lines.push({ text: first, page: ctx.page });
    for (let r = ctx.r + 1; r < ctx.rows.length && lines.length < 8; r++) {
      const cell = ctx.rows[r].find(c => Math.abs(c.x - ctx.c.x) <= doc.tol);
      if (!cell) break;
      if (STOP.test(cell.text) && !/^(?:pan|gstin)/i.test(cell.text)) break;
      lines.push({ text: cell.text, page: ctx.page });
    }
    return lines;
  }
  function entityFromBlock(doc, lines, explicit) {
    if (!lines.length) return null;
    let pan = null, gstin = null; const rest = [];
    for (const l of lines) {
      const g = RE.gstin.exec(l.text), p = RE.pan.exec(l.text);
      if (g && !gstin) gstin = mkField(g[0], 'high', doc, l.page, l.text);
      if (p && !pan && !g) pan = mkField(p[0], 'high', doc, l.page, l.text);
      if ((g || p) && /^(?:pan|gstin|gst)/i.test(l.text)) continue;
      rest.push(l);
    }
    if (gstin && !pan) { const derived = gstin.value.slice(2, 12); pan = { value: derived, confidence: 'medium', source: { ...gstin.source, text: 'derived from GSTIN ' + gstin.value } }; }
    if (!rest.length) return null;
    const conf = explicit ? 'high' : 'low';
    return {
      name: mkField(rest[0].text, conf, doc, rest[0].page, rest[0].text),
      address: rest.length > 1 ? mkField(rest.slice(1).map(l => l.text).join('\n'), explicit ? 'medium' : 'low', doc, rest[1].page, rest.slice(1).map(l => l.text).join(' / ')) : null,
      pan, gstin
    };
  }

  function findParty(doc, labelRe) {
    for (const ctx of allCells(doc)) {
      if (!labelRe.test(ctx.c.text)) continue;
      if (labelRe === LABELS.to && /^to\s*(?:be|tal|day)\b/i.test(ctx.c.text)) continue;
      const e = entityFromBlock(doc, blockAfter(doc, ctx, labelRe), true);
      if (e) return e;
    }
    return null;
  }

  /* ---------- totals and line items ---------- */
  function findTotals(doc) {
    const out = { subtotal: null, taxRates: [], taxAmounts: [], total: null };
    for (const ctx of allCells(doc)) {
      const t = ctx.c.text, rowText = ctx.row.map(c => c.text).join('  ');
      if (ctx.k !== 0 && ctx.row[0] !== ctx.c && !/^(?:sub|grand|total|gst|igst|cgst|sgst|tax|amount due|balance)/i.test(t)) continue;
      const valueFromRow = () => { const nums = ctx.row.slice(ctx.k).map(c => parseMoney(c.text.replace(/\(.*?\)/g, '').replace(/\d+(?:\.\d+)?\s*%/g, ''))).filter(n => n !== null); return nums.length ? nums[nums.length - 1] : null; };
      if (/^(?:sub\s*-?\s*total|taxable\s*(?:value|amount)|amount\s*before\s*tax|net\s*amount)\b/i.test(t)) { const v = valueFromRow(); if (v !== null && !out.subtotal) out.subtotal = mkField(v, 'high', doc, ctx.page, rowText); }
      else if (/^(?:grand\s*total|total\s*(?:amount|due|payable|invoice\s*value)?|amount\s*(?:due|payable)|balance\s*due|net\s*payable)\b/i.test(t) && !/sub/i.test(t)) { const v = valueFromRow(); if (v !== null) { if (!out.total || /grand|due|payable/i.test(t)) out.total = mkField(v, /grand|due|payable/i.test(t) ? 'high' : 'medium', doc, ctx.page, rowText); } }
      else if (/^(?:i?gst|cgst|sgst|utgst|tax|vat)\b/i.test(t) && !/^tax\s*invoice/i.test(t) && /\d/.test(rowText)) {
        const rate = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(rowText); const v = valueFromRow();
        out.taxRates.push({ kind: /^cgst/i.test(t) ? 'cgst' : /^sgst|^utgst/i.test(t) ? 'sgst' : /^igst/i.test(t) ? 'igst' : 'gst', rate: rate ? Number(rate[1]) : null, text: rowText, page: ctx.page });
        if (v !== null) out.taxAmounts.push(v);
      }
    }
    return out;
  }
  function findItems(doc) {
    const items = []; let inTable = false; // a table may continue onto following pages
    for (const p of doc.pages) {
      for (let r = 0; r < p.rows.length; r++) {
        const row = p.rows[r], joined = row.map(c => c.text).join(' ');
        if (!inTable) { if (/\b(?:description|particulars|item|service)s?\b/i.test(joined) && /\b(?:amount|total|price|rate|value)\b/i.test(joined)) inTable = true; continue; }
        if (!row.length) continue;
        if (/^(?:sub\s*-?\s*total|total|grand|taxable|gst|igst|cgst|sgst|amount in words|bank|notes?|payment|terms)\b/i.test(row[0].text) || /^(?:sub\s*-?\s*total|total|grand)/i.test(joined)) { inTable = false; continue; }
        let cells = row.slice();
        // single-space pasted text: "Design work  Rs. 5,000.00" arrives as one cell — split off a trailing amount
        if (cells.length === 1) { const m = /^(.*\S)\s+(?:₹|Rs\.?|INR)?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?:\s*\/?-)?$/i.exec(cells[0].text); if (m && /[A-Za-z]/.test(m[1])) cells = [{ x: cells[0].x, text: m[1] }, { x: cells[0].x + m[1].length + 1, text: m[2] }]; }
        if (cells.length >= 3 && /^\d{1,3}\.?$/.test(cells[0].text)) cells = cells.slice(1);
        const last = cells[cells.length - 1]; const amount = cells.length > 1 ? parseMoney(last.text) : null;
        const desc = clean(cells.slice(0, amount !== null ? -1 : cells.length).map(c => c.text).filter(t => !/^(?:₹|rs\.?|inr)?\s*[\d,.]+$/i.test(t) && !/^\d+(?:\.\d+)?%?$/.test(t)).join(' '));
        if (amount !== null && desc) items.push({ description: mkField(desc, 'medium', doc, p.page, joined), amountPaise: mkField(amount, 'medium', doc, p.page, joined) });
        else if (desc && items.length && amount === null) { const prev = items[items.length - 1]; prev.description.value += ' ' + desc; prev.description.confidence = 'low'; }
      }
    }
    return items;
  }

  /* ---------- one document ---------- */
  function analyzeDocument(doc) {
    const warnings = []; const w = (code, severity, message) => warnings.push({ code, severity, doc: doc.name, message });
    const text = doc.pages.map(p => p.rows.map(r => r.map(c => c.text).join(' ')).join('\n')).join('\n');
    const result = { doc: doc.name, sender: null, recipient: null, invoiceNumber: null, date: null, dueText: null, paymentTerms: null, currency: null, items: [], subtotal: null, taxRate: null, taxPaise: null, total: null, bank: {}, warnings, draftable: false, reasons: [] };
    if (!/\binvoice\b|\btax\s*invoice\b|\bbill\b|\bamount\b|\btotal\b/i.test(text)) w('NOT_INVOICE', 'warn', 'This does not look like an invoice. Nothing was extracted with confidence.');

    result.sender = findParty(doc, LABELS.from); result.recipient = findParty(doc, LABELS.to);
    if (!result.sender) {
      // Letterhead fallback: first non-empty lines before any label. Low confidence and flagged.
      const first = doc.pages[0].rows.slice(0, 6).filter(r => r.length).map(r => r[0]).filter(c => !/^(?:tax\s*)?invoice\b/i.test(c.text) && !LABELS.to.test(c.text) && !STOP.test(c.text));
      if (first.length) { result.sender = { name: mkField(first[0].text, 'low', doc, 1, first[0].text), address: null, pan: null, gstin: null }; w('SENDER_GUESSED', 'warn', 'No "From" label found; the sender name is a guess from the top of the page.'); }
    }
    if (!result.recipient) w('RECIPIENT_MISSING', 'warn', 'No "Bill to / Invoice to" section found, so no client was suggested.');
    if (result.sender && result.recipient && norm(result.sender.name.value) === norm(result.recipient.name.value)) w('SENDER_EQUALS_RECIPIENT', 'error', 'Sender and recipient look identical; the roles may be mixed up.');

    const num = labelled(doc, /\binvoice\s*(?:no\.?|number|#)\s*:?/i, /([A-Z0-9][A-Z0-9\-\/]{2,29})/i);
    if (num) result.invoiceNumber = mkField(num.v[1], 'high', doc, num.ctx.page, num.text);
    const dt = labelled(doc, /\b(?:invoice\s*date|dated|date\s*of\s*issue|date)\b\s*:?/i, /(\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?[\s\-]+[A-Za-z]{3,9}\.?,?[\s\-]+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/);
    if (dt) { const d = parseDate(dt.v[1]); if (d) { result.date = mkField(d.iso, d.confidence, doc, dt.ctx.page, dt.text); if (d.note) w('DATE_AMBIGUOUS', 'warn', 'Invoice date "' + dt.v[1] + '": ' + d.note); } }
    if (!result.date) w('DATE_MISSING', 'warn', 'No invoice date could be read.');

    const terms = labelled(doc, /\bpayment\s*terms?\s*:?|\bterms\s*:?/i, /(.{3,80})/) || labelled(doc, /\b(?:due\s*date|payment\s*due|due\s*on)\s*:?/i, /(.{3,40})/);
    const net = /\b(?:net\s*\d{1,3}|due\s*(?:in|within)\s*\d{1,3}\s*days?|payable\s*within\s*\d{1,3}\s*days?)\b/i.exec(text);
    if (terms) result.paymentTerms = mkField(clean(terms.v[1]), 'medium', doc, terms.ctx.page, terms.text); else if (net) result.paymentTerms = mkField(net[0], 'medium', doc, 1, net[0]);

    const cur = currencyOf(text); result.currency = cur.length === 1 ? cur[0] : cur.length ? cur : null;
    if (cur.length > 1) w('MIXED_CURRENCY', 'error', 'More than one currency appears (' + cur.join(', ') + '). Invoice Studio supports INR only.');
    else if (cur.length === 1 && cur[0] !== 'INR') w('UNSUPPORTED_CURRENCY', 'error', 'This invoice is in ' + cur[0] + '. Invoice Studio supports INR only, so no draft was created.');
    else if (!cur.length) w('CURRENCY_UNKNOWN', 'warn', 'No currency symbol found; amounts are assumed to be in rupees. Please confirm.');

    for (const [k, re] of [['ifsc', RE.ifsc]]) { const m = re.exec(text); if (m) result.bank.ifsc = mkField(m[0], 'high', doc, 1, m[0]); }
    const acc = labelled(doc, /\ba\/?c(?:count)?\s*(?:no\.?|number|#)?\s*:?/i, /\b(\d{6,20})\b/); if (acc) result.bank.acc = mkField(acc.v[1], 'medium', doc, acc.ctx.page, acc.text);
    const bank = labelled(doc, /\bbank(?:\s*name)?\s*:\s*/i, /([A-Za-z][A-Za-z &.]{2,60})/, { allowBelow: false }); if (bank) result.bank.bank = mkField(clean(bank.v[1]), 'medium', doc, bank.ctx.page, bank.text);
    const br = labelled(doc, /\bbranch\s*:?/i, /([A-Za-z][A-Za-z &.]{2,60})/, { allowBelow: false }); if (br) result.bank.branch = mkField(clean(br.v[1]), 'medium', doc, br.ctx.page, br.text);
    const ty = /\b(savings|current)\b(?:\s*account)?/i.exec(text); if (ty) result.bank.type = mkField(ty[1][0].toUpperCase() + ty[1].slice(1).toLowerCase(), 'low', doc, 1, ty[0]);

    result.items = findItems(doc);
    const tot = findTotals(doc); result.subtotal = tot.subtotal; result.total = tot.total;
    // tax rate: CGST+SGST pair (equal halves) or a single GST/IGST rate
    const rates = tot.taxRates.filter(x => x.rate !== null);
    let rate = null;
    if (rates.length) {
      const c = rates.find(x => x.kind === 'cgst'), s = rates.find(x => x.kind === 'sgst');
      if (c && s && c.rate === s.rate) rate = c.rate * 2; else if (rates.length === 1 || new Set(rates.map(x => x.rate)).size === 1 && rates.every(x => x.kind !== 'cgst' && x.kind !== 'sgst')) rate = rates[0].rate; else w('MIXED_TAX', 'error', 'Several different tax rates appear. Invoice Studio supports one rate per invoice, so this was not flattened into a draft.');
      if (rate !== null) result.taxRate = mkField(rate, rates.length === 1 || (c && s) ? 'high' : 'medium', doc, rates[0].page, rates.map(x => x.text).join(' | '));
    }
    if (tot.taxAmounts.length) result.taxPaise = mkField(tot.taxAmounts.reduce((a, b) => a + b, 0), 'medium', doc, 1, 'tax lines');

    // arithmetic checks
    const itemSum = result.items.reduce((a, i) => a + i.amountPaise.value, 0);
    const sub = result.subtotal?.value ?? (result.items.length ? itemSum : null);
    if (result.items.length && result.subtotal && itemSum !== result.subtotal.value) w('ITEMS_DONT_SUM', 'error', 'Line items add up to ' + itemSum / 100 + ' but the subtotal says ' + result.subtotal.value / 100 + '.');
    if (sub !== null && result.total) {
      const tax = result.taxPaise?.value ?? (result.taxRate ? Core.taxFor(sub, result.taxRate.value) : 0);
      if (sub + tax !== result.total.value && Math.abs(sub + tax - result.total.value) > 1) w('TOTAL_MISMATCH', 'error', 'Subtotal ' + sub / 100 + ' + tax ' + tax / 100 + ' does not equal the stated total ' + result.total.value / 100 + '.');
    }
    if (result.taxRate && sub !== null && result.taxPaise && Math.abs(Core.taxFor(sub, result.taxRate.value) - result.taxPaise.value) > 1) w('TAX_MISMATCH', 'error', 'Tax amount does not match ' + result.taxRate.value + '% of the subtotal.');
    if (result.taxRate && !Core.TAX_RATES.includes(result.taxRate.value)) { w('TAX_RATE_UNSUPPORTED', 'error', 'Tax rate ' + result.taxRate.value + '% is not one of 0, 5, 12, 18 or 28, so no draft was created.'); }
    if (!result.taxRate && sub !== null && result.total && sub === result.total.value && !tot.taxRates.length) { result.taxRate = mkField(0, 'low', doc, 1, 'total equals subtotal; no tax line found'); w('TAX_ASSUMED_ZERO', 'warn', 'No tax line found and total equals subtotal: 0% GST is suggested. Please confirm.'); }
    if (!result.taxRate && !tot.taxRates.length && sub !== null && result.total && sub !== result.total.value) w('TAX_UNKNOWN', 'error', 'The total differs from the subtotal but no tax rate could be read.');

    // draftability under the current one-description / one-rate schema.
    // HARD reasons cannot be fixed by typing a value (wrong currency, several line items, inconsistent arithmetic, no client);
    // FIXABLE ones are fields the reviewer can fill in or correct before approving.
    const hard = [], fixable = [];
    if (cur.some(c => c !== 'INR')) hard.push('currency is not INR');
    if (result.items.length > 1) hard.push('multiple line items — the current invoice model has a single description; import would flatten them');
    if (warnings.some(x => x.severity === 'error' && !['TAX_UNKNOWN', 'TAX_RATE_UNSUPPORTED'].includes(x.code))) hard.push('calculation or consistency errors in the source');
    if (!result.recipient) hard.push('no client found');
    if (result.items.length === 0) fixable.push('description and amount');
    if (!result.taxRate || !Core.TAX_RATES.includes(result.taxRate.value)) fixable.push('GST rate');
    if (!result.date) fixable.push('invoice date');
    result.hardReasons = hard; result.fixable = fixable;
    result.reasons = hard.concat(fixable.map(f => 'missing or unclear: ' + f)); result.draftable = result.reasons.length === 0;
    if (result.items.length > 1) w('MULTI_LINE', 'warn', result.items.length + ' line items found. They are listed for reference but no draft is proposed because the current invoice has one description and one tax rate.');
    return result;
  }

  /* ---------- multi-document analysis ---------- */
  function analyze(docs) {
    if (!Array.isArray(docs) || !docs.length) throw new Error('Nothing to import.');
    if (docs.length > LIMITS.maxDocs) throw new Error('Too many files (limit ' + LIMITS.maxDocs + ').');
    const results = docs.map(d => { try { return analyzeDocument(d); } catch (e) { return { doc: d?.name || 'file', sender: null, recipient: null, invoiceNumber: null, date: null, items: [], bank: {}, hardReasons: ['could not be read'], fixable: [], reasons: ['could not be read'], draftable: false, warnings: [{ code: 'PARSE_FAILED', severity: 'error', doc: d?.name || 'file', message: 'This file could not be analysed and was skipped.' }] }; } });
    const warnings = results.flatMap(r => r.warnings);

    // clients: merge the same recipient across documents
    const clients = [];
    results.forEach((r, di) => {
      if (!r.recipient) return;
      const e = r.recipient, key = e.gstin?.value || e.pan?.value || null, nm = norm(e.name.value);
      let hit = clients.find(c => (key && c.keys.has(key)) || (!key && c.names.has(nm)) || [...c.names].some(n => similar(n, nm)));
      if (!hit) { hit = { id: 'c' + (clients.length + 1), keys: new Set(), names: new Set(), name: e.name, address: e.address, pan: e.pan, gstin: e.gstin, mentions: [] }; clients.push(hit); }
      else {
        if (e.pan && hit.pan && e.pan.value !== hit.pan.value) warnings.push({ code: 'CLIENT_PAN_CONFLICT', severity: 'error', doc: r.doc, message: 'Client "' + e.name.value + '" appears with two different PAN numbers across documents. Check before importing.' });
        if (e.address && hit.address && norm(e.address.value) !== norm(hit.address.value)) warnings.push({ code: 'CLIENT_ADDRESS_DIFFERS', severity: 'warn', doc: r.doc, message: 'Client "' + e.name.value + '" has different addresses in different documents; the first was kept.' });
        for (const f of ['pan', 'gstin', 'address']) if (!hit[f] && e[f]) hit[f] = e[f];
        if (hit.name.value !== e.name.value && (hit.name.value.length < e.name.value.length)) hit.altNames = [...(hit.altNames || []), e.name.value]; else hit.altNames = [...(hit.altNames || []), e.name.value];
      }
      if (key) hit.keys.add(key); hit.names.add(nm); hit.mentions.push(r.doc); r.clientId = hit.id;
    });

    // business (sender): most frequent sender; flag disagreement and swapped roles
    const groups = [];
    results.forEach(r => { if (!r.sender) return; const nm = norm(r.sender.name.value); const g = groups.find(x => similar(x.nm, nm) || (r.sender.pan && x.sender.pan && x.sender.pan.value === r.sender.pan.value)); if (g) { g.count++; g.docs.push(r.doc); for (const f of ['address', 'pan', 'gstin']) if (!g.sender[f] && r.sender[f]) g.sender[f] = r.sender[f]; } else groups.push({ nm, sender: { ...r.sender }, count: 1, docs: [r.doc] }); });
    groups.sort((a, b) => b.count - a.count);
    let business = null;
    if (groups.length) {
      const top = groups[0]; business = { name: top.sender.name, address: top.sender.address, pan: top.sender.pan, gstin: top.sender.gstin, bank: {}, documents: top.docs };
      for (const r of results) if (top.docs.includes(r.doc)) for (const [k, v] of Object.entries(r.bank)) if (!business.bank[k]) business.bank[k] = v;
      if (groups.length > 1) warnings.push({ code: 'MULTIPLE_SENDERS', severity: 'error', doc: null, message: 'The documents come from ' + groups.length + ' different senders (' + groups.map(g => '"' + g.sender.name.value + '"').join(', ') + '). Only the most common was suggested as your business.' });
      for (const c of clients) if (groups.some(g => similar(g.nm, norm(c.name.value)))) warnings.push({ code: 'ROLE_SWAP', severity: 'error', doc: null, message: '"' + c.name.value + '" appears as a sender in one document and a client in another. Check which side is you.' });
    }
    const invoices = results.map((r, i) => ({ id: 'i' + (i + 1), doc: r.doc, draftable: r.draftable, reasons: r.reasons, hardReasons: r.hardReasons || [], fixable: r.fixable || [], clientId: r.clientId || null,
      originalNumber: r.invoiceNumber, date: r.date, description: r.items[0]?.description || null, items: r.items, amountPaise: r.subtotal || r.items[0]?.amountPaise || null,
      taxRate: r.taxRate, taxPaise: r.taxPaise, totalPaise: r.total, currency: r.currency, paymentTerms: r.paymentTerms }));
    return { business, clients: clients.map(({ keys, names, ...c }) => c), invoices, warnings, stats: { documents: docs.length, drafts: invoices.filter(x => x.draftable).length }, requiresApproval: true };
  }

  /* ---------- approvals -> validated writes (nothing is executed here) ---------- */
  // approvals: { business:boolean, clients:{[id]:boolean}, invoices:{[id]:boolean} }; existing: { clients:[UI client records], sender }
  function toWrites(proposal, approvals, existing = {}) {
    const errors = [], out = { sender: null, clients: [], drafts: [] };
    approvals = approvals || {};
    if (approvals.business && proposal.business) {
      const b = proposal.business, bk = b.bank || {};
      const v = Core.validateSender({ name: b.name.value, addr: b.address?.value || '', pan: b.pan?.value || '', type: bk.type?.value || '', bank: bk.bank?.value || '', branch: bk.branch?.value || '', acc: bk.acc?.value || '', ifsc: bk.ifsc?.value || '' });
      if (v.error) errors.push('Business details: ' + v.error); else out.sender = { value: v.value, replacesExisting: !!(existing.sender && existing.sender.name) };
    }
    const approvedClient = new Map();
    for (const c of proposal.clients) {
      if (!approvals.clients?.[c.id]) continue;
      const v = Core.validateClient({ name: c.name.value, addr: c.address?.value || '', pan: c.pan?.value || '', gstin: c.gstin?.value || '' });
      if (v.error) { errors.push('Client "' + c.name.value + '": ' + v.error); continue; }
      const dup = (existing.clients || []).find(x => (v.value.gstin && x.gstin === v.value.gstin) || (v.value.pan && x.pan === v.value.pan) || norm(x.name) === norm(v.value.name));
      if (dup) approvedClient.set(c.id, { existingId: dup.id }); else { out.clients.push({ tempId: c.id, value: v.value }); approvedClient.set(c.id, { tempId: c.id }); }
    }
    for (const inv of proposal.invoices) {
      if (!approvals.invoices?.[inv.id]) continue;
      if (inv.hardReasons?.length) { errors.push('Invoice from "' + inv.doc + '" cannot be drafted: ' + inv.hardReasons.join('; ')); continue; }
      const cid = String(inv.clientId || '');
      const ref = cid.startsWith('existing:') ? ((existing.clients || []).some(x => x.id === cid.slice(9)) ? { existingId: cid.slice(9) } : null) : approvedClient.get(cid);
      if (!ref) { errors.push('Invoice from "' + inv.doc + '": choose a client you have approved or one you already have.'); continue; }
      const sub = inv.amountPaise?.value; if (!Number.isInteger(sub)) { errors.push('Invoice from "' + inv.doc + '": enter the amount.'); continue; }
      const amount = Math.floor(sub / 100) + '.' + String(sub % 100).padStart(2, '0');
      const v = Core.validateInvoiceInput({ amount, reg: inv.description?.value, date: inv.date?.value, taxRate: inv.taxRate?.value, clientId: ref.existingId || 'pending-' + inv.clientId });
      if (v.error) { errors.push('Invoice from "' + inv.doc + '": ' + v.error); continue; }
      // Always a DRAFT: no invoice number, no issue, no history. The source number is kept for reference only.
      out.drafts.push({ docId: inv.id, clientRef: ref, input: v.value, referenceNumber: inv.originalNumber?.value || null });
    }
    return { ok: errors.length === 0, errors, writes: out };
  }

  return { LIMITS, docFromText, docFromRows, analyze, analyzeDocument, toWrites, parseMoney, parseDate, currencyOf, norm, similar };
});
