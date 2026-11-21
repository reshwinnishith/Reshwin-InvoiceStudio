'use strict';
/* Smart Import onboarding UI — DEVELOPMENT FLAG ONLY (localhost + ?smartimport=1). Optional: "Start blank instead" always works.
   Local only: files are parsed in the browser (pdf.js, same-origin in development); nothing is uploaded; nothing is saved until the
   user approves items. Raw content lives in this closure and is cleared on logout, cancel and after saving. Rendered with textContent only. */
(function () {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!local || new URLSearchParams(location.search).get('smartimport') !== '1') return;
  window.SMART_IMPORT_ENABLED = true;
  const SI = window.SmartImport, Core = window.InvoiceCore, $ = id => document.getElementById(id);
  const MAX_FILES = 10, MAX_BYTES = 15 * 1024 * 1024;
  const PDFJS_BASE = window.SMART_IMPORT_PDFJS_BASE || '/vendor/pdfjs/'; // pinned, vendored, same-origin (see vendor/pdfjs/MANIFEST.json)
  let ext = null, proposal = null, reports = [], busy = false, done = null, inputs = {};
  const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k === 'for') e.htmlFor = v; else e[k] = v; } kids.flat().forEach(k => k != null && e.append(k)); return e; };
  const msg = (t, kind) => { const m = $('si_msg'); m.textContent = t || ''; m.hidden = !t; m.className = 'msg' + (kind ? ' ' + kind : ''); };
  const freshDone = () => ({ business: false, clients: {}, invoices: {} });

  function reset({ keepFiles = false } = {}) {
    proposal = null; reports = []; inputs = {}; done = null; $('si_review').replaceChildren(); $('si_review').hidden = true; $('si_input').hidden = false; $('si_text').value = ''; if (!keepFiles) $('si_files').value = ''; msg('');
    ext?.setDirty(false);
  }
  const hasWork = () => !!(proposal || $('si_text').value.trim() || $('si_files').files.length);

  /* ---------- reading files (each file independently: one bad file never loses the others) ---------- */
  async function readFile(f) {
    if (f.size === 0) throw new Error('the file is empty');
    if (f.size > MAX_BYTES) throw new Error('the file is larger than 15 MB');
    const head = new Uint8Array(await f.slice(0, 8).arrayBuffer()), isPdf = String.fromCharCode(...head.slice(0, 5)) === '%PDF-';
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf' || isPdf) {
      if (!isPdf) throw new Error('this is not a valid PDF file');
      let pdfjs; try { pdfjs = await import(PDFJS_BASE + 'pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs'; } catch (e) { throw new Error('the PDF reader could not be loaded'); }
      const { extractPdfRows } = await import('/pdftext.mjs');
      let r; try { r = await extractPdfRows(pdfjs, await f.arrayBuffer()); } catch (e) { throw new Error(e && /password/i.test(e.name + e.message) ? 'the PDF is password-protected' : /too (large|many)/i.test(e.message) ? e.message : 'the PDF is damaged or unreadable'); }
      if (r.scanned) throw new Error('this looks like a scan or photo (no readable text). Scanned PDFs need OCR, which is not available yet — type the details in yourself or paste the text');
      return SI.docFromRows(f.name, r.pages);
    }
    const text = await f.text();
    if (/\u0000/.test(text.slice(0, 2000))) throw new Error('this is not a text file');
    return SI.docFromText(f.name, text);
  }
  async function analyze() {
    if (busy) return; busy = true; $('si_go').disabled = true; msg('Reading…');
    try {
      const files = [...$('si_files').files]; reports = []; const docs = [];
      if (files.length > MAX_FILES) { msg('Please choose at most ' + MAX_FILES + ' files at a time.', 'err'); return; }
      for (const f of files) { try { docs.push(await readFile(f)); reports.push({ name: f.name, ok: true }); } catch (e) { reports.push({ name: f.name, ok: false, reason: e.message || 'could not be read' }); } }
      if ($('si_text').value.trim()) { try { docs.push(SI.docFromText('pasted text', $('si_text').value)); reports.push({ name: 'pasted text', ok: true }); } catch (e) { reports.push({ name: 'pasted text', ok: false, reason: e.message }); } }
      if (!docs.length) { msg(reports.length ? 'Nothing could be read. ' + reports.map(r => r.name + ': ' + r.reason).join(' · ') : 'Choose a PDF or paste some text first.', 'err'); return; }
      proposal = SI.analyze(docs); done = freshDone(); render(); ext.setDirty(true);
      msg(''); $('si_review').querySelector('h3')?.focus?.();
    } catch (e) { proposal = null; msg(e.message || 'Could not read that.', 'err'); }
    finally { busy = false; $('si_go').disabled = false; }
  }

  /* ---------- review screen ---------- */
  const evidence = f => f ? el('div', { class: 'si-ev' }, el('b', { textContent: 'Found in ' + f.source.doc + (f.source.page ? ', page ' + f.source.page : '') + ': ' }), '“' + f.source.text + '”') : el('div', { class: 'si-ev', textContent: 'Not found in your documents — leave it blank or type it yourself.' });
  function field(key, label, f, { textarea = false, type = 'text', inputMode, select } = {}) {
    const id = 'si_f_' + key, quality = !f ? 'missing' : f.confidence === 'low' ? 'low' : '';
    const control = select ? el('select', { id }, ...select.map(([v, t]) => el('option', { value: v, textContent: t }))) : textarea ? el('textarea', { id, rows: 3, maxLength: 2000 }) : el('input', { id, type, maxLength: 200, autocomplete: 'off', inputMode: inputMode || '' });
    control.value = f ? String(f.value ?? '') : ''; inputs[key] = { control, original: f ? String(f.value ?? '') : '' };
    return el('div', { class: 'si-field ' + quality }, el('label', { for: id }, el('span', { textContent: label }), el('span', { class: 'badge ' + (f ? f.confidence : 'missing'), textContent: f ? f.confidence : 'not found' })), control, evidence(f));
  }
  const card = (id, title, sub, on, children, locked) => { const c = el('input', { type: 'checkbox', id, checked: !!on, disabled: !!locked }); return el('div', { class: 'si-card', id: id + '_card' }, el('div', { class: 'si-head' }, c, el('label', { for: id }, el('div', { class: 't', textContent: title }), sub ? el('div', { class: 's', textContent: sub }) : null)), children); };
  const rupees = paise => paise == null ? '' : Math.floor(paise / 100) + '.' + String(paise % 100).padStart(2, '0');

  function render() {
    const root = $('si_review'); root.replaceChildren(); inputs = {}; const p = proposal;
    $('si_input').hidden = true; root.hidden = false;
    root.append(el('h3', { tabIndex: -1, textContent: 'Review what we found' }), el('p', { class: 'si-note', textContent: 'Nothing is saved yet. Check each item, fix anything highlighted, then tick what you want to create. Imported invoices become drafts — they are never issued and get no invoice number.' }));
    const bad = reports.filter(r => !r.ok);
    if (reports.length) root.append(el('ul', { class: 'si-files' }, ...reports.map(r => el('li', { class: r.ok ? '' : 'bad', textContent: r.ok ? r.name + ' — read' : r.name + ' — skipped: ' + r.reason }))));
    const errs = p.warnings.filter(w => w.severity === 'error'), warns = p.warnings.filter(w => w.severity !== 'error');
    if (p.warnings.length) { root.append(el('div', { class: 'si-sec', textContent: 'Check these (' + p.warnings.length + ')' })); [...errs, ...warns].forEach(w => root.append(el('div', { class: 'si-warn ' + w.severity, textContent: (w.severity === 'error' ? '⚠ ' : '• ') + (w.doc ? '[' + w.doc + '] ' : '') + w.message }))); }
    if (p.business) {
      const b = p.business, bk = b.bank || {}, has = !!ext.state.from.name;
      root.append(el('div', { class: 'si-sec', textContent: 'Your business' }), card('si_biz', 'Use as my business details', has ? 'Replaces the details you already saved' : 'Shown on every new invoice', false, [
        field('b_name', 'Name or business', b.name), field('b_address', 'Address', b.address, { textarea: true }), field('b_pan', 'PAN', b.pan),
        field('b_bank', 'Bank name', bk.bank), field('b_branch', 'Branch', bk.branch), field('b_acc', 'Account number', bk.acc, { inputMode: 'numeric' }), field('b_ifsc', 'IFSC', bk.ifsc), field('b_type', 'Account type', bk.type)]));
    }
    if (p.clients.length) root.append(el('div', { class: 'si-sec', textContent: 'Clients' }));
    for (const c of p.clients) {
      const dup = ext.state.clients.find(x => (c.gstin && x.gstin === c.gstin.value) || (c.pan && x.pan === c.pan.value) || SI.norm(x.name) === SI.norm(c.name.value));
      root.append(card('si_c_' + c.id, 'Add client: ' + c.name.value, dup ? 'Already in your clients — it will be reused, not duplicated' : 'Seen in ' + c.mentions.join(', '), false, [
        field(c.id + '_name', 'Client name', c.name), field(c.id + '_address', 'Address', c.address, { textarea: true }), field(c.id + '_pan', 'PAN', c.pan), field(c.id + '_gstin', 'GSTIN', c.gstin)]));
    }
    if (p.invoices.length) root.append(el('div', { class: 'si-sec', textContent: 'Draft invoices' }));
    const clientOptions = [['', 'Choose a client…'], ...p.clients.map(c => [c.id, c.name.value + ' (from import)']), ...ext.state.clients.map(c => ['existing:' + c.id, c.name + ' (existing)'])];
    for (const i of p.invoices) {
      const blocked = i.hardReasons.length > 0;
      const kids = blocked ? [el('div', { class: 'si-warn error', textContent: 'Can’t be imported as a draft: ' + i.hardReasons.join('; ') + '. Create it yourself with + if you need it.' })] : [
        field(i.id + '_client', 'Client', i.clientId ? { value: i.clientId, confidence: 'medium', source: { doc: i.doc, text: 'its “Bill to” section' } } : null, { select: clientOptions }),
        field(i.id + '_date', 'Invoice date', i.date, { type: 'date' }), field(i.id + '_desc', 'Description of work', i.description, { textarea: true }),
        field(i.id + '_amount', 'Amount before GST (₹)', i.amountPaise ? { ...i.amountPaise, value: rupees(i.amountPaise.value) } : null, { inputMode: 'decimal' }),
        field(i.id + '_tax', 'GST rate', i.taxRate, { select: [['', 'Choose…'], ...Core.TAX_RATES.map(r => [String(r), r + '%'])] }),
        el('div', { class: 'si-note', textContent: (i.originalNumber ? 'Original number ' + i.originalNumber.value + ' is for reference only; ' : '') + 'a new number is assigned only when you issue the draft.' + (i.paymentTerms ? ' Payment terms noted: “' + i.paymentTerms.value + '” (not stored).' : '') })];
      root.append(card('si_i_' + i.id, 'Create a draft from ' + i.doc, blocked ? 'Not available' : (i.fixable.length ? 'Please complete: ' + i.fixable.join(', ') : 'Looks complete — still check it'), false, kids, blocked));
    }
    root.append(el('div', { class: 'si-actions' }, el('button', { class: 'btn', id: 'si_apply', textContent: 'Create approved items', onclick: apply }), el('button', { class: 'btn sec', id: 'si_cancel', textContent: 'Cancel import', onclick: cancel })));
    root.append(el('p', { class: 'si-note', textContent: 'Prefer to enter things yourself? Cancel and use your details and + as usual.' }));
  }
  function cancel() { if (hasWork() && !confirm('Discard this import? Nothing has been saved.')) return; reset(); ext.go('home'); }

  /* ---------- turn the (possibly corrected) form into a validated write plan ---------- */
  function collect() {
    const P = JSON.parse(JSON.stringify(proposal)), errors = [];
    const val = k => (inputs[k] ? inputs[k].control.value.trim() : ''), changed = k => inputs[k] && val(k) !== inputs[k].original.trim();
    const upd = (obj, key, k) => { if (!inputs[k]) return; if (!changed(k)) return; const v = val(k); obj[key] = v ? { value: v, confidence: 'high', source: { doc: 'you', text: 'typed or corrected by you' } } : null; };
    if (P.business) { const b = P.business; b.bank = b.bank || {}; upd(b, 'name', 'b_name'); upd(b, 'address', 'b_address'); upd(b, 'pan', 'b_pan'); for (const [f, k] of [['bank', 'b_bank'], ['branch', 'b_branch'], ['acc', 'b_acc'], ['ifsc', 'b_ifsc'], ['type', 'b_type']]) upd(b.bank, f, k); }
    for (const c of P.clients) for (const f of ['name', 'address', 'pan', 'gstin']) upd(c, f, c.id + '_' + f);
    for (const i of P.invoices) {
      if (i.hardReasons.length) continue;
      i.clientId = val(i.id + '_client') || null;
      const d = val(i.id + '_date'); i.date = d ? { value: d } : null;
      const t = val(i.id + '_desc'); i.description = t ? { value: t } : null;
      const a = val(i.id + '_amount'); if (a) { const paise = Core.parseAmount(a); if (paise === null) errors.push('Invoice from "' + i.doc + '": enter the amount like 1500 or 1500.50.'); i.amountPaise = paise === null ? null : { value: paise }; } else i.amountPaise = null;
      const r = val(i.id + '_tax'); i.taxRate = r === '' ? null : { value: Number(r) };
    }
    return { P, errors };
  }
  async function apply() {
    if (busy) return;
    const { P, errors } = collect(); if (errors.length) return msg(errors.join(' '), 'err');
    const appr = { business: !!$('si_biz')?.checked, clients: {}, invoices: {} };
    P.clients.forEach(c => appr.clients[c.id] = !!$('si_c_' + c.id)?.checked); P.invoices.forEach(i => appr.invoices[i.id] = !!$('si_i_' + i.id)?.checked);
    // items already created by an earlier, partly failed attempt are not created again
    if (done.business) appr.business = false; for (const k of Object.keys(done.clients)) appr.clients[k] = false;
    const plan = SI.toWrites(P, appr, { sender: ext.state.from, clients: ext.state.clients });
    if (!plan.ok) { const e = $('si_msg'); $('si_input').hidden = false; msg(plan.errors.join(' '), 'err'); $('si_input').hidden = true; $('si_review').insertBefore(el('p', { class: 'msg err', role: 'alert', textContent: plan.errors.join(' ') }), $('si_review').firstChild); window.scrollTo(0, 0); return; }
    const w = plan.writes; $('si_review').querySelectorAll('.msg.err').forEach(m => m.remove());
    const pending = (w.sender ? 1 : 0) + w.clients.length + w.drafts.filter(d => !done.invoices[d.docId]).length;
    if (!pending) return alert('Nothing is selected yet. Tick the items you want to create.');
    if (!confirm('Create ' + (w.sender ? 'your business details, ' : '') + w.clients.length + ' client(s) and ' + w.drafts.length + ' draft invoice(s)? Drafts get no invoice number until you issue them.')) return;
    busy = true; const created = [];
    const ok = await ext.perform($('si_apply'), async ws => {
      let sender = ext.state.from;
      if (w.sender) { await ws.saveSender(w.sender.value, ext.state.senderToken); sender = w.sender.value; done.business = true; created.push('details'); }
      const recs = {};
      for (const c of w.clients) { const id = await ws.saveClient(c.value, null); done.clients[c.tempId] = id; recs[id] = { id, ...c.value }; created.push('client'); }
      for (const d of w.drafts) {
        if (done.invoices[d.docId]) continue;
        const id = d.clientRef.existingId || done.clients[d.clientRef.tempId]; const rec = recs[id] || ext.state.clients.find(x => x.id === id);
        if (!rec || !sender?.name) throw Object.assign(new Error('Add your business details first (tick “Use as my business details”) — drafts need them.'), { code: 'invalid' });
        await ws.saveDraft(null, { ...d.input, clientId: id }, { id, name: rec.name, addr: rec.addr, pan: rec.pan, gstin: rec.gstin }, sender); done.invoices[d.docId] = true; created.push('draft');
      }
    });
    busy = false;
    if (ok) { reset(); ext.toast('Created ' + created.length + ' item(s). Your drafts are on the home screen.'); ext.go('home'); }
    else if (created.length) { for (const c of Object.keys(done.clients)) { const cb = $('si_c_' + c); if (cb) { cb.checked = false; cb.disabled = true; } } if (done.business && $('si_biz')) { $('si_biz').checked = false; $('si_biz').disabled = true; } ext.toast('Some items were created before an error. They won’t be created twice if you retry.'); }
  }
  function open() { reset(); ext.go('import'); }
  function boot() {
    ext = window.InvoiceApp.ext(); ext.onTeardown(() => { reset(); });
    window.InvoiceApp.openSmartImport = open;
    const b = $('openImport'); b.hidden = false; b.onclick = open;
    $('si_go').onclick = analyze; $('si_skip').onclick = () => { reset(); ext.go('home'); };
    $('si_files').addEventListener('change', () => ext.setDirty(hasWork())); $('si_text').addEventListener('input', () => ext.setDirty(hasWork()));
  }
  if (window.InvoiceApp?.ext) boot(); else window.addEventListener('DOMContentLoaded', boot);
})();
