// Renders FICTIONAL invoices as (1) the on-screen paper and (2) the downloaded PDF, then compares them:
// completeness of every value, anchor positions (where wrapping is identical), page bounds, overlaps, draft/number rules.
// Real Chrome, no Firebase, no network except the pinned jsPDF script. Run: node tests/e2e/pdf-parity.e2e.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core'; import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { FIXTURES } from './parity-fixtures.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const out = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const hdr = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers[0].headers.map(h => [h.key, h.value]));
const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'); const f = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname); if (!f.startsWith(root) || /node_modules|firebase-prep/.test(f) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { ...hdr, 'content-type': mime[path.extname(f)] || 'x/y' }); if (f.endsWith('index.html')) return r.end(fs.readFileSync(f, 'utf8').replace(/<script[^>]*src="(?:firebase-config\.js|boot\.mjs)"[^>]*><\/script>/g, '')); fs.createReadStream(f).pipe(r); }).listen(5179, '127.0.0.1');
const results = []; const ok = (n, c, x = '') => { results.push([c ? 'PASS' : 'FAIL', n + (x ? ' — ' + x : '')]); if (!c) process.exitCode = 1; };
const W = 794, H = 1123, SIDE_X = 54, norm = s => String(s).replace(/\s+/g, ' ').trim();
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await (await b.newContext({ viewport: { width: 900, height: 1200 } })).newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|firebase|gstatic/i.test(m.text())) errs.push(m.text().slice(0, 140)); });
await page.goto('http://127.0.0.1:5179/'); await page.waitForSelector('#v-welcome', { state: 'attached' }); await page.waitForTimeout(1200);

async function render(inv) {
  const r = await page.evaluate(async inv => {
    document.querySelectorAll('section[id^=v-]').forEach(s => s.hidden = s.id !== 'v-invoice');
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const m = InvoiceView.model(inv); const paper = document.getElementById('paper'); paper.innerHTML = InvoiceView.paperHtml(m, esc); paper.style.transform = 'none'; document.getElementById('stage').style.height = 'auto'; await document.fonts.ready;
    const pr = paper.getBoundingClientRect(); const rel = el => { const range = document.createRange(); range.selectNodeContents(el); const r = range.getClientRects()[0] || el.getBoundingClientRect(); return { x: r.left - pr.left, right: r.right - pr.left, cy: (r.top + r.bottom) / 2 - pr.top, text: el.textContent.trim() }; };
    const q = sel => [...paper.querySelectorAll(sel)].map(rel);
    const { blob } = await InvoicePDF.blob(inv); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const c of buf) s += String.fromCharCode(c);
    return { model: m, dom: { title: q('.p-title'), ev: q('.p-ev'), nm: q('.p-nm'), desc: q('td.desc'), amt: q('td.r'), gv: q('.gv'), wv: q('.wv'), bankv: q('.p-bgrid .v'), height: pr.height }, pdf: btoa(s) };
  }, inv);
  return r;
}
async function pdfItems(b64) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(b64, 'base64')), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise; const pages = [];
  for (let p = 1; p <= doc.numPages; p++) { const pg = await doc.getPage(p); const vp = pg.getViewport({ scale: 1 }); const tc = await pg.getTextContent();
    const px = 96 / 72; const items = tc.items.filter(i => i.str.trim()).map(i => { const h = Math.abs(i.transform[3]) * px, x = i.transform[4] * px, base = (vp.height - i.transform[5]) * px; return { s: i.str, x, right: x + i.width * px, base, cy: base - 0.3 * h, w: i.width * px, h }; });
    pages.push({ items, wpx: vp.width * px, hpx: vp.height * px }); }
  return { pages, n: doc.numPages };
}
const SAME_LAYOUT = ['issued', 'draft', 'paid', 'void', 'noOptional', 'highAmount', 'specialChars'];
for (const [name, inv] of Object.entries(FIXTURES)) {
  try {
    const r = await render(inv); const P = await pdfItems(r.pdf); const text = norm(P.pages.flatMap(p => p.items.map(i => i.s)).join(' ')); const m = r.model;
    fs.writeFileSync(path.join(out, name + '.pdf'), Buffer.from(r.pdf, 'base64'));
    const plain = s => norm(s).replace(/[^\x20-\x7E -ÿ]/g, c => c === '–' || c === '—' ? '-' : c === '’' ? "'" : c === '“' || c === '”' ? '"' : c === '…' ? '...' : '?');
    const missing = [];
    const need = [m.title, m.numberText, m.dateText, m.subtotal.slice(1), m.tax.slice(1), m.total.slice(1), m.rows[0].amount.slice(1), m.words, m.taxLabel, ...m.bank.map(([, v]) => v), ...(m.from.pan ? ['PAN ' + m.from.pan] : []), ...m.to.tax.map(([k, v]) => k + ' ' + v)];
    for (const n of need) if (!norm(text).replace(/ /g, '').includes(plain(n).replace(/ /g, ''))) missing.push(n.slice(0, 40));
    // wrapped fields (names, addresses, description) are checked word by word: columns interleave in reading order
    const wrapped = [m.from.name, m.from.addr, m.to.name, m.to.addr].flatMap(v => plain(v).split(' ')).filter(Boolean);
    const words = [...plain(m.rows[0].desc).split(' '), ...wrapped].filter(Boolean); const hay = text.replace(/ /g, ''); const lost = words.filter(w => !hay.includes(w.replace(/ /g, '')));
    ok(`${name}: every value and every word of the description is in the PDF`, missing.length === 0 && lost.length === 0, missing.concat(lost.slice(0, 3)).join('|'));
    ok(`${name}: ${m.isDraft ? 'draft is labelled and has no number' : 'number ' + m.numberText + ' and status wording match the screen'}`, m.isDraft ? (/Draft/.test(text) && /Assigned when issued/.test(text) && !/RESH-\d{4}-\d/.test(text)) : text.includes(m.numberText) && (m.status !== 'void' || /Void/.test(text)));
    const out1 = P.pages.flatMap((p, i) => p.items.filter(it => it.x < 20 || it.right > W - 20 || it.base > H - 5 || it.base < 5).map(it => `p${i + 1}:${it.s.slice(0, 16)}`));
    ok(`${name}: nothing outside the page margins (${P.n} page${P.n > 1 ? 's' : ''})`, out1.length === 0, out1.slice(0, 3).join(','));
    let overlaps = 0; for (const pg of P.pages) for (let i = 0; i < pg.items.length; i++) for (let j = i + 1; j < pg.items.length; j++) { const a = pg.items[i], c = pg.items[j]; const ox = Math.min(a.right, c.right) - Math.max(a.x, c.x), oy = Math.min(a.base, c.base) - Math.max(a.base - a.h, c.base - c.h); if (ox > 2 && oy > 0.45 * Math.min(a.h, c.h)) overlaps++; }
    ok(`${name}: no overlapping text`, overlaps === 0, overlaps + ' overlaps');
    // Party columns flow independently: consecutive address lines (12.5px) in one column are evenly spaced (20px), never padded by the other column.
    const uneven = P.pages.flatMap((pg, pi) => [SIDE_X, W / 2 + SIDE_X].flatMap(cx => { const ls = pg.items.filter(i => Math.abs(i.h - 12.5) < 0.3 && Math.abs(i.x - cx) < 1).sort((a, c) => a.base - c.base);
      return ls.slice(1).map((l, k) => l.base - ls[k].base).filter(d => Math.abs(d - 20) > 0.6).map(d => `p${pi + 1}@${cx}:${d.toFixed(1)}`); }));
    // On continued pages the first description line must not touch the repeated table header (bar ends ~111px from the top).
    const cramped = P.pages.slice(1).flatMap((pg, pi) => { const hdrBar = pg.items.find(i => i.s.replace(/\s/g, '') === 'DESCRIPTION'); if (!hdrBar) return [];
      const first = pg.items.filter(i => Math.abs(i.h - 14) < 0.3 && i.base > hdrBar.base).sort((a, c) => a.base - c.base)[0];
      return first && first.base - first.h - (hdrBar.base + 13) < 8 ? [`p${pi + 2}:${(first.base - first.h - hdrBar.base - 13).toFixed(1)}`] : []; });
    ok(`${name}: continued description lines have space below the table header`, cramped.length === 0, cramped.join(','));
    ok(`${name}: address lines in each party column are evenly spaced`, uneven.length === 0, uneven.slice(0, 3).join(','));
    if (P.n > 1) ok(`${name}: multi-page output has page numbers`, new RegExp(`Page ${P.n} of ${P.n}`).test(text));
    if (SAME_LAYOUT.includes(name)) {
      const pg = P.pages[0].items, find = s => pg.find(i => i.s.includes(s)), findLast = s => pg.filter(i => i.s.includes(s)).pop(); const checks = [];
      const near = (label, d, p, tol = 18) => { if (!p) { checks.push(label + ' missing'); return; } const dx = Math.abs((d.x ?? 0) - p.x), dy = Math.abs(d.cy - p.cy); if (dx > tol || dy > tol) checks.push(`${label} Δx=${dx.toFixed(0)} Δy=${dy.toFixed(0)}`); };
      near('number', r.dom.ev[0], find(m.numberText.split(' ')[0])); near('date', r.dom.ev[1], find(m.dateText)); near('from', r.dom.nm[0], find(m.from.name.split(' ')[0])); near('to', r.dom.nm[1], find(m.to.name.split(' ')[0]));
      const d0 = r.dom.desc[0]; near('description', d0, find(plain(m.rows[0].desc).slice(0, 24)));
      const gv = findLast(m.total.slice(1)); if (!gv || Math.abs(gv.right - r.dom.gv[0].right) > 20 || Math.abs(gv.cy - r.dom.gv[0].cy) > 18) checks.push('grand total position');
      const wv = pg.find(i => i.s.includes('Rupees')); if (!wv || Math.abs(wv.x - r.dom.wv[0].x) > 20 || Math.abs(wv.cy - r.dom.wv[0].cy) > 18) checks.push('amount in words position');
      const t = pg.filter(i => i.s.startsWith('Invoice')).sort((a, c) => c.h - a.h)[0]; if (!t || Math.abs((t.x + t.right) / 2 - W / 2) > 25) checks.push('title not centred');
      ok(`${name}: positions of title, number, parties, description, totals and words match the screen (±18px)`, checks.length === 0, checks.join('; '));
    }
  } catch (e) { ok(`${name}: aborted`, false, e.message.split('\n')[0]); }
}
for (const [label, text] of [['Devanagari', 'Fictional सेवा'], ['check mark', 'Fictional ✓']]) {
  let unicodeRejected = false;
  try { await render({ ...FIXTURES.issued, reg: text }); }
  catch (e) { unicodeRejected = /Unicode font/.test(e.message); }
  ok(`unsupported ${label} is refused with a print fallback instead of corrupting invoice text`, unicodeRejected);
}
ok('no console or page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log(results.map(r => r.join(' ')).join('\n')); console.log('PDFs saved in', out); await b.close(); srv.close();
