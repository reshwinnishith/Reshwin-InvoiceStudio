'use strict';
/* One invoice presentation model shared by every renderer (on-screen preview, PDF, copy-as-text).
   The on-screen layout is the canonical design; renderers must not re-derive labels, numbers or wording themselves.
   Pure functions: no DOM, no network, no storage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.InvoiceView = factory(root.InvoiceCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const below1000 = n => { const h = Math.floor(n / 100), r = n % 100; return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? (r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? ' ' + ONES[r % 10] : '')) : ''); };
  function words(n) {
    if (n === 0) return 'Zero';
    const parts = [];
    for (const [v, label] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [1, '']]) {
      const count = Math.floor(n / v); n %= v;
      if (count) parts.push((count < 1000 ? below1000(count) : words(count)) + (label ? ' ' + label : ''));
    }
    return parts.join(' ');
  }
  const amountWords = paise => { const r = Math.floor(paise / 100), p = paise % 100; return 'Rupees ' + words(r) + (p ? ' and ' + words(p) + ' Paise' : '') + ' Only'; };
  const money = paise => '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function dateLabel(s) {
    if (!Core.validDate(s)) return '—';
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  const status = inv => (Core.STATUSES.includes(inv?.status) ? inv.status : 'issued');
  const STATUS_LABEL = { draft: 'Draft', issued: 'Issued', paid: 'Paid', void: 'Void' };

  function model(inv) {
    const st = status(inv), f = inv.from || {}, c = inv.client || {};
    const subtotal = inv.amountPaise || 0, tax = inv.taxPaise || 0, total = inv.totalPaise ?? subtotal;
    // The payment block appears only when at least one real bank field exists (a lone name is not "bank details").
    const real = [['Account No.', f.acc], ['Bank', f.bank], ['Branch', f.branch], ['Type', f.type], ['IFSC', f.ifsc]].filter(([, v]) => String(v || '').trim());
    const bank = real.length ? [['Name', f.name], ...real].filter(([, v]) => String(v || '').trim()) : [];
    return {
      status: st, statusLabel: STATUS_LABEL[st], isDraft: st === 'draft',
      title: 'Invoice' + (st === 'draft' ? ' — Draft' : st === 'void' ? ' — Void' : ''),
      numberText: inv.no ? inv.no : 'Assigned when issued', dateText: dateLabel(inv.date),
      from: { name: f.name || '', addr: f.addr || '', pan: f.pan || '' },
      to: { name: c.name || '', addr: c.addr || '', tax: [c.pan ? ['PAN', c.pan] : null, c.gstin ? ['GSTIN', c.gstin] : null].filter(Boolean) },
      rows: [{ sno: '01', desc: inv.reg || '', amount: money(subtotal) }],
      subtotal: money(subtotal), taxLabel: 'GST (' + (inv.taxRate || 0) + '%)', tax: money(tax), total: money(total), words: amountWords(total), bank,
      fileName: (inv.no || 'Draft-invoice').replace(/[^A-Za-z0-9._-]+/g, '-') + '.pdf'
    };
  }
  // On-screen paper markup (the canonical design). `esc` is supplied by the caller.
  function paperHtml(m, esc) {
    const taxBlock = m.to.tax.map(([k, v]) => '<div><span class="k">' + k + ' </span>' + esc(v) + '</div>').join('');
    const bank = m.bank.length ? '<div class="p-bank"><div class="bl">Bank Details for NEFT / RTGS</div><div class="p-bgrid">' + m.bank.map(([k, v]) => '<span class="k">' + k + '</span><span class="v">' + esc(v) + '</span>').join('') + '</div></div>' : '';
    return '<div class="p-top"></div><div class="p-title">' + esc(m.title) + '</div>' +
      '<div class="p-meta"><div><div class="p-ek">Invoice No.</div><div class="p-ev">' + esc(m.numberText) + '</div></div><div><div class="p-ek">Invoice Date</div><div class="p-ev">' + esc(m.dateText) + '</div></div></div>' +
      '<div class="p-parties"><div><div class="p-lbl">From</div><div class="p-nm">' + esc(m.from.name) + '</div><div class="p-ad">' + esc(m.from.addr) + '</div>' + (m.from.pan ? '<div class="p-tax">PAN ' + esc(m.from.pan) + '</div>' : '') + '</div>' +
      '<div><div class="p-lbl">Invoice To</div><div class="p-nm">' + esc(m.to.name) + '</div><div class="p-ad">' + esc(m.to.addr) + '</div><div class="p-tax">' + taxBlock + '</div></div></div>' +
      '<table class="p-items"><thead><tr><th>S.No</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>' + m.rows.map(r => '<tr><td>' + r.sno + '</td><td class="desc">' + esc(r.desc) + '</td><td class="r">' + esc(r.amount) + '</td></tr>').join('') + '</tbody></table>' +
      '<div class="p-spacer"></div><div class="p-tot"><div class="box"><div class="p-trow"><span>Subtotal</span><span>' + esc(m.subtotal) + '</span></div><div class="p-trow line"><span>' + esc(m.taxLabel) + '</span><span>' + esc(m.tax) + '</span></div><div class="p-grand"><span class="gl">Grand Total</span><span class="gv">' + esc(m.total) + '</span></div></div></div>' +
      '<div class="p-words"><div class="wk">Amount in words</div><div class="wv">' + esc(m.words) + '</div></div>' + bank;
  }
  function plainText(m) {
    const lines = ['INVOICE ' + (m.isDraft ? '(draft)' : m.numberText), 'Date: ' + m.dateText, '', 'From:', m.from.name, m.from.addr, m.from.pan ? 'PAN: ' + m.from.pan : '', '', 'To:', m.to.name, m.to.addr, ...m.to.tax.map(([k, v]) => k + ': ' + v), '', m.rows[0].desc, 'Subtotal: ' + m.subtotal, m.taxLabel + ': ' + m.tax, 'Total: ' + m.total, m.words];
    if (m.bank.length) lines.push('', ...m.bank.map(([k, v]) => k + ': ' + v));
    return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  }
  return { money, dateLabel, amountWords, status, STATUS_LABEL, model, paperHtml, plainText };
});
