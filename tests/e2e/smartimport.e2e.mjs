// Smart Import onboarding — real Chrome + local emulators + FICTIONAL PDFs/text. Dev flag only. Run via `npm run test:smartimport:e2e`.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright-core';
import { FICT } from '../fixtures/make-fixtures.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const out = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'si-shots-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const hdr = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers[0].headers.map(h => [h.key, h.key === 'Content-Security-Policy' ? h.value.replace('connect-src ', 'connect-src http://127.0.0.1:19099 http://127.0.0.1:18080 ') : h.value]));
const server = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'); const f = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
  const okPath = f.startsWith(root) && !/firebase-preparation|\.git\//.test(f) && !f.includes('node_modules');
  if (!okPath || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { ...hdr, 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(5174, '127.0.0.1');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-e2e-')); const F = {};
for (const k of ['basic', 'second', 'multiPage', 'usd', 'scanned', 'protectedPdf', 'tooManyPages']) { F[k] = path.join(tmp, k + '.pdf'); fs.writeFileSync(F[k], FICT[k]()); }
F.notpdf = path.join(tmp, 'notpdf.pdf'); fs.writeFileSync(F.notpdf, 'this is plain text pretending to be a pdf');
F.corrupt = path.join(tmp, 'corrupt.pdf'); fs.writeFileSync(F.corrupt, '%PDF-1.4\n1 0 obj\ngarbage garbage\n');
F.empty = path.join(tmp, 'empty.txt'); fs.writeFileSync(F.empty, '');
F.big = path.join(tmp, 'big.txt'); fs.writeFileSync(F.big, Buffer.alloc(16 * 1024 * 1024, 65));
const results = []; const ok = (n, c, x = '') => { results.push([c ? 'PASS' : 'FAIL', n + (x ? ' — ' + x : '')]); if (!c) process.exitCode = 1; };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--host-resolver-rules=MAP prod-like.test 127.0.0.1'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const page = await ctx.newPage(); const errors = [], dialogs = [];
let dialogMode = 'accept'; page.on('dialog', d => { dialogs.push(d.message()); (dialogMode === 'dismiss' ? d.dismiss() : d.accept()).catch(() => {}); });
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const U = 'http://127.0.0.1:5174/?emulator=1&smartimport=1';
const waitFor = async (fn, arg, t = 20000) => { const end = Date.now() + t; while (Date.now() < end) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(100); } throw new Error('timeout ' + fn.toString().slice(0, 90)); };
const shot = async n => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${n}.png` }); };
const fullShot = async n => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${n}.png`, fullPage: true }); };
async function verify(e) { const r = await (await fetch('http://127.0.0.1:19099/emulator/v1/projects/demo-invoice-studio-v2/oobCodes')).json(); const c = r.oobCodes.filter(x => x.email === e && x.requestType === 'VERIFY_EMAIL').at(-1);
  await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:update?key=x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oobCode: c.oobCode }) }); }
const requests = []; ctx.on('request', r => requests.push(r.url()));
const email = `fictional-si-${Date.now()}@example.test`;
const clickText = async (sel) => { await page.click(sel); };
try {
  await page.goto(U); await page.waitForSelector('#v-welcome:not([hidden])'); await page.click('#au_tab_up'); await page.fill('#au_email', email); await page.fill('#au_pass', 'Fictional-1'); await page.fill('#au_pass2', 'Fictional-1'); await page.click('#au_submit');
  await page.waitForSelector('#v-verify:not([hidden])'); await verify(email); await page.click('#vf_check'); await page.waitForSelector('#v-home:not([hidden])');
  // ---- onboarding offer and the blank path ----
  await waitFor(() => !!document.getElementById('siOnboard')); const offer = await page.textContent('#iblist');
  ok('empty home offers Smart Import with the approved wording and a blank-profile alternative', /Have an old invoice\? Drop it here/.test(offer) && /start with a blank profile/.test(offer)); await shot('01-home-onboarding');
  await page.click('#siOnboard'); await page.waitForSelector('#v-import:not([hidden])'); await shot('02-import-input');
  await page.click('#si_skip'); await page.waitForSelector('#v-home:not([hidden])');
  ok('"Start blank instead" returns home and creates nothing', (await page.evaluate(() => document.getElementById('ibcount').textContent)).startsWith('0'));
  // ---- limits: too many files, oversize file ----
  const reqStart = requests.length;
  await page.click('#siOnboard'); await page.waitForSelector('#v-import:not([hidden])');
  await page.setInputFiles('#si_files', Array.from({ length: 11 }, () => F.basic)); await page.click('#si_go'); await page.waitForTimeout(400);
  ok('more than 10 files is refused with a clear message', /at most 10 files/.test(await page.textContent('#si_msg')));
  await page.setInputFiles('#si_files', [F.big, F.basic]); await page.click('#si_go'); await page.waitForSelector('#si_review:not([hidden]) .si-card', { timeout: 30000 });
  ok('a file over 15 MB is skipped with its reason, the other file is read', /big\.txt — skipped: the file is larger than 15 MB/.test(await page.textContent('#si_review')) && /basic\.pdf — read/.test(await page.textContent('#si_review')));
  await page.click('#si_cancel'); await page.waitForSelector('#v-home:not([hidden])');
  // ---- messy batch: bad files are skipped one by one, good ones are read ----
  await page.click('#siOnboard'); await page.waitForSelector('#v-import:not([hidden])');
  await page.setInputFiles('#si_files', [F.scanned, F.notpdf, F.corrupt, F.empty, F.basic, F.second, F.usd, F.multiPage, F.protectedPdf, F.tooManyPages]);
  await page.fill('#si_text', 'Invoice No: T-1\nDate: 2026-09-01\nFrom:\nFictional Studio\n1 Example Street\nBill To:\nPasted Fictional Client\n3 Paste Road\nDescription     Amount\nFictional pasted job   Rs. 2,000.00\nSubtotal   2,000.00\nTotal   2,000.00');
  await page.click('#si_go'); await page.waitForSelector('#si_review:not([hidden]) .si-card', { timeout: 40000 }); await page.waitForTimeout(300);
  const rv = await page.textContent('#si_review');
  ok('each bad file is skipped with its own plain reason; good files are still read', /scanned\.pdf — skipped: this looks like a scan/.test(rv) && /notpdf\.pdf — skipped: this is not a valid PDF/.test(rv) && /corrupt\.pdf — skipped: the PDF is damaged/.test(rv) && /empty\.txt — skipped: the file is empty/.test(rv) && /basic\.pdf — read/.test(rv));
  ok('password-protected PDF and over-long PDF are skipped with plain reasons', /protectedPdf\.pdf — skipped: the PDF is password-protected/.test(rv) && /tooManyPages\.pdf — skipped: PDF has too many pages \(limit 50\)/.test(rv));
  ok('error messages leak none of the skipped files\' contents', !/SECRET-1|Secret Fictional|garbage|pretending|Fictional page/.test(rv));
  const imp = requests.slice(reqStart); const hosts = [...new Set(imp.map(u => new URL(u).host))];
  ok('PDF reading is local: the pinned worker loads from our own origin; no CDN, node_modules or third-party request during import', imp.some(u => u.endsWith('/vendor/pdfjs/pdf.worker.min.mjs')) && imp.some(u => u.endsWith('/vendor/pdfjs/pdf.min.mjs')) && hosts.every(h => ['127.0.0.1:5174', '127.0.0.1:18080', '127.0.0.1:19099', 'fonts.gstatic.com', 'fonts.googleapis.com'].includes(h)) && !imp.some(u => /node_modules|jsdelivr|cdn\./.test(u)), hosts.join(','));
  ok('scan message is honest about OCR', /Scanned PDFs need OCR, which is not available/.test(rv));
  ok('business, 4 clients and invoice cards are shown; nothing pre-approved', (await page.locator('#si_review .si-card').count()) >= 7 && (await page.locator('#si_review input[type=checkbox]:checked').count()) === 0, (await page.locator('#si_review .si-card').count()) + ' cards');
  ok('missing information is highlighted as "not found" and uncertain values as low', (await page.locator('.si-field.missing').count()) > 0 && (await page.locator('.badge.missing').count()) > 0);
  ok('every value shows its evidence (document, page and snippet)', /Found in basic\.pdf, page 1: “/.test(rv));
  ok('USD and multi-line invoices cannot be imported, with reasons', /Can’t be imported as a draft: currency is not INR/.test(rv) && /multiple line items/.test(rv));
  ok('never invented: the PAN field of a document without one is empty', await page.evaluate(() => { const f = [...document.querySelectorAll('#si_review .si-card')].find(c => /Pasted Fictional Client/.test(c.textContent)); const pan = f.querySelector('input[id$="_pan"]'); return pan && pan.value === ''; }));
  await fullShot('03-review-390');
  ok('review fits a phone: no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok('all review fields have labels (accessibility)', await page.evaluate(() => [...document.querySelectorAll('#v-import input:not([type=file]), #v-import select, #v-import textarea')].every(e => e.labels && e.labels.length)));
  // nothing ticked -> nothing written
  dialogs.length = 0; await page.click('#si_apply'); await page.waitForTimeout(400); ok('applying with nothing ticked writes nothing and says so', dialogs.some(d => /Nothing is selected/.test(d)));
  // ---- corrections ----
  await page.fill('#si_f_b_name', 'Corrected Fictional Studio'); await page.fill('#si_f_c1_address', 'Corrected Road\nCorrectville 999999');
  const iBasic = await page.evaluate(() => { const i = [...document.querySelectorAll('#si_review .si-card')].find(c => /draft from basic\.pdf/.test(c.textContent)); return i.querySelector('input[type=checkbox]').id.replace('si_i_', ''); });
  const iSecond = await page.evaluate(() => { const i = [...document.querySelectorAll('#si_review .si-card')].find(c => /draft from second\.pdf/.test(c.textContent)); return i.querySelector('input[type=checkbox]').id.replace('si_i_', ''); });
  await page.fill(`#si_f_${iBasic}_desc`, 'Corrected description of work'); await page.fill(`#si_f_${iBasic}_amount`, '31000.50');
  await page.check('#si_biz'); await page.check('#si_c_c1'); await page.check(`#si_i_${iBasic}`); await page.check(`#si_i_${iSecond}`);
  await page.fill(`#si_f_${iSecond}_amount`, 'abc'); await page.click('#si_apply'); await page.waitForTimeout(500);
  ok('an invalid corrected amount is refused with a clear message', /enter the amount/.test(await page.textContent('#si_msg')));
  await page.fill(`#si_f_${iSecond}_amount`, '10000'); dialogs.length = 0; await shot('04-review-ready');
  await page.click('#si_apply'); await page.waitForSelector('#v-home:not([hidden])', { timeout: 30000 }); await waitFor(() => document.querySelectorAll('#iblist .inv').length === 2);
  ok('approved items were created after confirmation', dialogs.some(d => /Create your business details, 1 client\(s\) and 2 draft invoice\(s\)\? Drafts get no invoice number/.test(d)), dialogs.join('|').slice(0, 120));
  const rows = await page.locator('#iblist .inv .num').allTextContents(); ok('imported invoices are DRAFTS with no number (never issued)', rows.every(t => t.trim() === 'Draft'), rows.join(','));
  await page.click('#iblist .inv >> nth=1'); await page.waitForSelector('#paper .p-nm'); const paper = await page.textContent('#paper');
  ok('the corrections (not the original values) were saved', /Corrected Fictional Studio/.test(paper) && /Corrected description of work/.test(paper) && /31,000\.50/.test(paper) && /Assigned when issued/.test(paper));
  await shot('05-imported-draft'); await page.click('#backBtn'); await page.click('#navClients'); await waitFor(() => document.querySelectorAll('#clientList .clientrow').length === 1);
  ok('exactly the one approved client was created', true); await page.click('#backBtn');
  // ---- duplicate import ----
  await page.click('#setBtn'); await page.click('#openImport'); await page.waitForSelector('#v-import:not([hidden])'); await page.setInputFiles('#si_files', [F.basic]); await page.click('#si_go'); await page.waitForSelector('#si_review .si-card');
  ok('a client that already exists is recognised and reused', /Already in your clients — it will be reused, not duplicated/.test(await page.textContent('#si_review')));
  ok('replacing existing business details is flagged', /Replaces the details you already saved/.test(await page.textContent('#si_review')));
  await page.check('#si_c_c1'); const i3 = await page.evaluate(() => document.querySelector('#si_review input[id^=si_i_]').id.replace('si_i_', '')); await page.check(`#si_i_${i3}`); await page.click('#si_apply'); await page.waitForSelector('#v-home:not([hidden])'); await waitFor(() => document.querySelectorAll('#iblist .inv').length === 3);
  await page.click('#navClients'); await page.waitForTimeout(300); ok('importing a duplicate client created no second client', (await page.locator('#clientList .clientrow').count()) === 1); await page.click('#backBtn');
  // ---- leaving before saving / cancel ----
  await page.click('#setBtn'); await page.click('#openImport'); await page.waitForSelector('#v-import:not([hidden])'); await page.fill('#si_text', 'Invoice No: L-1\nFrom:\nLeaving Co\nBill To:\nLeaving Client'); dialogs.length = 0; dialogMode = 'dismiss';
  await page.click('#backBtn'); await page.waitForTimeout(400); ok('leaving with unsaved import content asks first, and staying keeps it', dialogs.some(d => /Discard your unsaved changes/.test(d)) && (await page.isVisible('#v-import')) && (await page.inputValue('#si_text')).includes('Leaving Co'));
  dialogMode = 'accept'; await page.click('#backBtn'); await page.waitForSelector('#v-settings:not([hidden]), #v-home:not([hidden])'); await page.click('#openImport').catch(() => {});
  ok('after discarding, the import form is empty again', (await page.evaluate(() => document.getElementById('si_text').value)) === '');
  await page.fill('#si_text', 'Invoice No: C-1\nFrom:\nCancel Co\nBill To:\nCancel Client\nDescription Amount\nWork Rs. 5.00\nTotal 5.00'); await page.click('#si_go'); await page.waitForSelector('#si_review .si-card'); await page.click('#si_cancel'); await page.waitForSelector('#v-home:not([hidden])');
  await page.click('#setBtn'); await page.click('#openImport'); ok('Cancel import discards the review and nothing was saved', (await page.locator('#si_review .si-card').count()) === 0);
  // ---- reduced motion + 320px ----
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 320, height: 640 });
  await page.setInputFiles('#si_files', [F.basic, F.second]); await page.click('#si_go'); await page.waitForSelector('#si_review .si-card'); await page.waitForTimeout(200);
  ok('320px: review has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await fullShot('06-review-320');
  ok('reduced motion: no screen animation', await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('v-import')).animationDuration) < 0.01));
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setViewportSize({ width: 390, height: 844 });
  // ---- logout clears ----
  dialogMode = 'accept'; await page.evaluate(() => { document.getElementById('si_text').value = 'private text'; }); await page.goto(U); await page.waitForSelector('#v-home:not([hidden])'); await page.click('#setBtn'); await page.click('#signOut'); await page.waitForSelector('#v-welcome:not([hidden])'); await page.waitForTimeout(1200);
  ok('after logout no import content survives', await page.evaluate(() => document.getElementById('si_text').value === '' && document.getElementById('si_review').innerHTML === ''));
  const prod = await ctx.newPage(); await prod.goto('http://prod-like.test:5174/?smartimport=1'); await prod.waitForSelector('#v-welcome', { state: 'attached' }); await prod.waitForTimeout(800);
  ok('on a non-local (production-like) hostname the feature stays OFF even with ?smartimport=1', !(await prod.evaluate(() => !!window.SMART_IMPORT_ENABLED)) && !(await prod.evaluate(() => !!window.InvoiceApp?.openSmartImport))); await prod.close();
  await page.goto('http://127.0.0.1:5174/?emulator=1'); await page.waitForSelector('#v-welcome:not([hidden])'); ok('without the dev flag Smart Import is absent', !(await page.evaluate(() => !!window.SMART_IMPORT_ENABLED)) && !(await page.isVisible('#openImport')));
} catch (e) { ok('aborted: ' + e.message.split('\n')[0], false, await page.evaluate(() => (document.getElementById('si_msg')?.textContent || '') + '|' + document.getElementById('toast').textContent).catch(() => '')); await page.screenshot({ path: `${out}/zz-fail.png` }).catch(() => {}); }
ok('no page or console errors (incl. CSP)', errors.length === 0, errors.slice(0, 2).join(' | '));
console.log(results.map(r => r.join(' ')).join('\n')); console.log('shots:', out); await b.close(); server.close();
