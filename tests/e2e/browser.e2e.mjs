import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
// Real-browser test against the LOCAL emulators only (run through `firebase emulators:exec`, see README).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.env.SHOTS || fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'invoice-e2e-'));
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Serve with the same security headers as production (vercel.json), plus loopback emulator hosts for connect-src in this test only.
const prodHeaders = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers[0].headers;
const headers = Object.fromEntries(prodHeaders.map(h => [h.key, h.key === 'Content-Security-Policy' ? h.value.replace('connect-src ', 'connect-src http://127.0.0.1:19099 http://127.0.0.1:18080 ') : h.value]));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'); let f = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(root) || f.includes('firebase-preparation') || f.includes('node_modules') || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { ...headers, 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(5173, '127.0.0.1');
const results = []; const ok = (n, c, extra = '') => { results.push([c ? 'PASS' : 'FAIL', n + (extra ? ' — ' + extra : '')]); if (!c) process.exitCode = 1; };
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
const failedRequests = [];
page.on('response', r => { if (r.status() >= 400) failedRequests.push(r.status() + ' ' + new URL(r.url()).pathname); });
page.on('dialog', d => d.accept());
// page.waitForFunction evaluates strings and is blocked by our strict CSP; poll with evaluate() (CDP) instead.
async function waitFor(fn, arg, { timeout = 15000 } = {}) { const end = Date.now() + timeout; while (Date.now() < end) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(100); } throw new Error('timeout waiting for ' + fn.toString().slice(0, 90)); }
await page.addInitScript(() => { window.__shared = []; window.__shareMode = 'ok';
  navigator.canShare = d => !!(d && d.files && d.files.length);
  navigator.share = async d => { if (window.__shareMode === 'cancel') throw new DOMException('cancelled', 'AbortError'); window.__shared.push({ name: d.files[0].name, type: d.files[0].type, size: d.files[0].size }); }; });
const shot = async n => { await page.waitForTimeout(350); return page.screenshot({ path: `${out}/${n}.png` }); };
const visible = async () => page.evaluate(() => [...document.querySelectorAll('section[id^=v-]')].filter(s => !s.hidden).map(s => s.id));
const email = `fictional-e2e-${Date.now()}@example.test`, pass = 'Fictional-Pass-1234';
async function verifyEmail(e) {
  const r = await (await fetch('http://127.0.0.1:19099/emulator/v1/projects/demo-invoice-studio-v2/oobCodes')).json();
  const c = r.oobCodes.filter(x => x.email === e && x.requestType === 'VERIFY_EMAIL').at(-1);
  await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:update?key=x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oobCode: c.oobCode }) });
}
try {
  await page.goto('http://127.0.0.1:5173/?emulator=1'); await page.waitForSelector('#v-welcome:not([hidden])', { timeout: 20000 });
  ok('welcome screen shown when signed out', (await visible()).join() === 'v-welcome'); await shot('01-welcome');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  ok('keyboard: Tab reaches the email field in order after the tabs', await page.evaluate(() => ['au_email', 'au_tab_in', 'au_tab_up'].includes(document.activeElement.id)), await page.evaluate(() => document.activeElement.id));
  await page.click('#au_tab_up'); await shot('02-create');
  await page.fill('#au_email', email); await page.fill('#au_pass', pass); await page.fill('#au_pass2', pass); await page.click('#au_submit');
  await page.waitForSelector('#v-verify:not([hidden])'); ok('unverified user held at verify screen', (await page.textContent('#vf_email')) === email); await shot('03-verify');
  await page.click('#vf_check'); await waitFor(() => /Not verified yet/.test(document.getElementById('vf_msg').textContent)); ok('check before verifying keeps user out', (await visible()).join() === 'v-verify');
  await verifyEmail(email); await page.click('#vf_check'); await page.waitForSelector('#v-home:not([hidden])', { timeout: 20000 }); ok('verified user reaches home', true); await shot('04-home-empty');
  // details
  await page.click('#navDetails'); await page.fill('#f_name', 'Fictional Sender'); await page.fill('#f_addr', '1 Example Street\nExample City'); await page.fill('#f_bank', 'Fictional Bank'); await page.fill('#f_acc', '123456789'); await page.click('#f_save');
  await page.waitForSelector('#v-home:not([hidden])'); ok('details saved to cloud', /Details saved/.test(await page.textContent('#toast'))); await shot('05-after-details');
  await page.click('#navClients'); await page.click('#addClient'); await page.fill('#ce_name', 'Fictional Client Ltd'); await page.fill('#ce_addr', 'Client Road'); await page.click('#ce_save');
  await waitFor(() => document.querySelectorAll('#clientList .clientrow').length === 1); ok('client saved and listed', true); await shot('06-clients');
  await page.click('#backBtn').catch(() => {}); await page.goto('http://127.0.0.1:5173/?emulator=1'); await page.waitForSelector('#v-home:not([hidden])', { timeout: 20000 });
  ok('session restored after full reload (no re-login)', true);
  const t0 = Date.now(); await page.click('#fab');
  ok('FAB: the + is rotating (spin class) right after the tap', await page.evaluate(() => document.getElementById('fab').classList.contains('spin') || !document.getElementById('v-generate').hidden));
  await page.waitForSelector('#v-generate:not([hidden])'); const dt = Date.now() - t0; ok('FAB: editor opens after a short animation (<= 700 ms incl. test overhead)', dt <= 700, dt + ' ms');
  ok('FAB: spin class is cleared after opening', await page.evaluate(() => !document.getElementById('fab').classList.contains('spin')));
  await page.selectOption('#g_client', { index: 0 }); await page.fill('#g_reg', 'Fictional design services'); await page.fill('#g_amt', '25000.50'); await page.selectOption('#g_tax', '0'); await page.click('#g_go');
  await waitFor(() => document.getElementById('invoiceStatus').textContent === 'Draft'); await page.waitForSelector('#paper .p-nm'); ok('draft created, no number yet', /Assigned when issued/.test(await page.textContent('#paper'))); await shot('07-draft');
  await page.click('#issueInv'); await page.waitForSelector('#issueSheet:not([hidden])', { timeout: 20000 });
  ok('issued: success sheet shows RESH-YYYY-001 only after the server confirmed', /RESH-\d{4}-001/.test(await page.textContent('#is_num'))); await shot('08-issued-sheet');
  ok('issued: sheet offers Share PDF, Download PDF, Copy text and Done', await page.evaluate(() => ['is_share', 'is_dl', 'is_copy', 'is_done'].every(i => document.getElementById(i) && !document.getElementById(i).closest('[hidden]'))));
  await page.click('#is_share'); await waitFor(() => window.__shared.length === 1); const shared = await page.evaluate(() => window.__shared[0]);
  ok('Share PDF hands the native share sheet a real PDF file', shared.type === 'application/pdf' && /^RESH-\d{4}-001\.pdf$/.test(shared.name) && shared.size > 2000, shared.name + ' ' + shared.size + 'B');
  await page.evaluate(() => { window.__shareMode = 'cancel'; }); await page.click('#is_share'); await page.waitForTimeout(600);
  ok('a dismissed share sheet changes nothing (sheet stays, no error)', (await page.isVisible('#issueSheet')) && !/unavailable|error/i.test(await page.textContent('#toast')));
  await page.evaluate(() => { window.__shareMode = 'ok'; });
  const [dl0] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), page.click('#is_dl')]); ok('Download PDF from the success sheet saves the PDF', !!dl0 && /\.pdf$/.test(dl0.suggestedFilename()));
  await page.click('#is_done'); await waitFor(() => document.getElementById('issueSheet').hidden); await waitFor(() => /RESH-\d{4}-001/.test(document.getElementById('paper').textContent));
  ok('issued with RESH-YYYY-001 number', true); await shot('08-issued');
  ok('issued invoice shows Share PDF + Download PDF as the prominent actions', await page.evaluate(() => !document.getElementById('shareInv').hidden && !document.getElementById('dl').hidden && document.getElementById('issueInv').hidden));
  // ---- home filters ----
  await page.click('#backBtn').catch(() => {}); await page.waitForSelector('#v-home:not([hidden])');
  await page.click('#fab'); await page.waitForSelector('#v-generate:not([hidden])'); await page.selectOption('#g_client', { index: 0 }); await page.fill('#g_reg', 'Fictional second job'); await page.fill('#g_amt', '300'); await page.selectOption('#g_tax', '0'); await page.click('#g_go'); await page.waitForSelector('#paper .p-nm');
  await page.click('#backBtn').catch(() => {}); await page.waitForSelector('#v-home:not([hidden])'); await waitFor(() => document.querySelectorAll('#iblist .inv').length === 2);
  const counts = await page.evaluate(() => ['all', 'drafts', 'issued'].map(k => document.getElementById('n_' + k).textContent).join(','));
  ok('filters: counts are All 2, Drafts 1, Issued 1', counts === '2,1,1', counts);
  await page.click('#flt_drafts'); ok('filters: Drafts shows only the draft (no number)', await page.evaluate(() => document.querySelectorAll('#iblist .inv').length === 1 && document.querySelector('#iblist .inv .num').textContent.trim() === 'Draft'));
  await page.click('#flt_issued'); ok('filters: Issued shows the issued invoice with its number and status', await page.evaluate(() => document.querySelectorAll('#iblist .inv').length === 1 && /RESH-\d{4}-001/.test(document.querySelector('#iblist .inv .num').textContent) && /Issued/.test(document.querySelector('#iblist .inv .st').textContent)));
  await shot('08b-home-issued-filter'); await page.click('#flt_all'); await shot('08c-home-all');
  ok('filters: tabs expose selected state to assistive tech', await page.evaluate(() => document.getElementById('flt_all').getAttribute('aria-selected') === 'true' && document.getElementById('flt_drafts').getAttribute('aria-selected') === 'false'));
  await page.click('#iblist .inv >> nth=1'); await page.waitForSelector('#paper .p-nm');
  // PDF
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(e => null), page.click('#dl')]);
  ok('PDF download produced a file', !!dl, dl ? dl.suggestedFilename() : 'no download (jsPDF CDN?)');
  if (dl) { const p = `${out}/invoice.pdf`; await dl.saveAs(p); ok('PDF has PDF header and size', fs.readFileSync(p).subarray(0, 5).toString() === '%PDF-' && fs.statSync(p).size > 2000, fs.statSync(p).size + ' bytes'); }
  await page.goto('http://127.0.0.1:5173/?emulator=1'); await page.waitForSelector('#v-home:not([hidden])'); await page.waitForSelector('#iblist .inv');
  await page.click('#iblist .inv'); await page.waitForSelector('#paper .p-nm'); await page.waitForTimeout(400); await shot('09-invoice-view');
  // ---- responsive + accessibility sweep at 320px (small iPhone width) while signed in ----
  await page.goto('http://127.0.0.1:5173/?emulator=1'); await page.waitForSelector('#v-home:not([hidden])'); await page.waitForSelector('#iblist .inv');
  await page.setViewportSize({ width: 320, height: 640 });
  const overflow = () => page.evaluate(() => { const vw = window.innerWidth; const bad = [...document.querySelectorAll('section:not([hidden]) *, #bar *')].filter(e => !e.closest('#stage') && e.getBoundingClientRect().right > vw + 1 && getComputedStyle(e).position !== 'fixed').map(e => e.id || e.className || e.tagName).slice(0, 3); return { scroll: document.documentElement.scrollWidth <= vw, bad }; });
  const unlabeled = () => page.evaluate(() => [...document.querySelectorAll('section:not([hidden]) input:not([type=hidden]), section:not([hidden]) select, section:not([hidden]) textarea')].filter(e => !(e.labels && e.labels.length) && !e.getAttribute('aria-label')).map(e => e.id));
  const sweep = async name => { const o = await overflow(); const u = await unlabeled(); ok(`320px layout: ${name} has no horizontal overflow`, o.scroll && o.bad.length === 0, o.bad.join(',')); ok(`accessibility: ${name} form fields all have labels`, u.length === 0, u.join(',')); };
  await sweep('home'); await shot('13-320-home');
  await page.click('#navDetails'); await sweep('details'); await shot('14-320-details'); await page.click('#backBtn');
  await page.click('#navClients'); await sweep('clients'); await page.click('#addClient'); await sweep('client form'); await page.click('#backBtn'); await page.click('#backBtn');
  await page.click('#fab'); await sweep('invoice editor'); await shot('15-320-editor'); await page.click('#backBtn');
  await page.click('#iblist .inv'); await page.waitForSelector('#paper .p-nm'); await sweep('invoice'); await shot('16-320-invoice'); await page.click('#backBtn');
  await page.click('#setBtn'); await sweep('settings'); await page.click('#backBtn');
  const focusOk = await (async () => { await page.click('#setBtn'); return page.evaluate(() => document.activeElement && document.activeElement.tagName === 'H2'); })();
  ok('accessibility: focus moves to the new screen heading on navigation', focusOk);
  await page.click('#backBtn'); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.click('#fab');
  ok('reduced motion: the editor opens immediately, no spin delay', await page.evaluate(() => !document.getElementById('v-generate').hidden && !document.getElementById('fab').classList.contains('spin')));
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.click('#backBtn');
  // Saved values are real values, not placeholders
  await page.click('#navDetails'); const det = await page.evaluate(() => ({ name: document.getElementById('f_name').value, bank: document.getElementById('f_bank').value, branchPh: document.getElementById('f_branch').placeholder, saved: !document.getElementById('f_saved').hidden, hint: document.getElementById('f_hint').hidden }));
  ok('details: saved fields show their saved values; hint hidden and "Saved" shown', det.name === 'Fictional Sender' && det.bank === 'Fictional Bank' && det.saved && det.hint, JSON.stringify({ n: det.name, b: det.bank }));
  ok('details: empty-field placeholders are generic hints, never sample bank data', /^e\.g\./.test(det.branchPh) && !/HDFC|Shenoy/.test(await page.content()));
  await shot('17-details-saved'); await page.click('#backBtn');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.__marker = 'private-page-state'; });
  // settings, sign out
  await page.goto('http://127.0.0.1:5173/?emulator=1'); await page.waitForSelector('#v-home:not([hidden])'); await page.click('#setBtn'); await shot('10-settings');
  await page.click('#signOut'); await page.waitForSelector('#v-welcome:not([hidden])'); await page.waitForTimeout(1500); ok('sign out returns to welcome', true);
  ok('logout reloads the page: in-memory SDK cache and page state are discarded', await page.evaluate(() => window.__marker === undefined));
  ok('private DOM cleared after logout', await page.evaluate(() => document.getElementById('iblist').innerHTML === '' && document.getElementById('paper').innerHTML === '' && document.getElementById('f_name').value === ''));
  // account B
  const email2 = `fictional-e2e-b-${Date.now()}@example.test`;
  await page.click('#au_tab_up'); await page.fill('#au_email', email2); await page.fill('#au_pass', pass); await page.fill('#au_pass2', pass); await page.click('#au_submit');
  await page.waitForSelector('#v-verify:not([hidden])'); await verifyEmail(email2); await page.click('#vf_check'); await page.waitForSelector('#v-home:not([hidden])');
  ok('second account sees an empty workspace', (await page.textContent('#ibcount')).startsWith('0') && !(await page.content()).includes('Fictional Client Ltd'));
  // ---- multi-tab: signing out in another tab ends this tab's session too ----
  const tab2 = await ctx.newPage(); tab2.on('dialog', d => d.accept());
  await tab2.goto('http://127.0.0.1:5173/?emulator=1'); await tab2.waitForSelector('#v-home:not([hidden])', { timeout: 20000 });
  await tab2.click('#setBtn'); await tab2.click('#signOut'); await tab2.waitForSelector('#v-welcome:not([hidden])', { timeout: 20000 });
  await waitFor(() => !document.getElementById('v-welcome').hidden, null, { timeout: 20000 });
  ok('signing out in another tab signs this tab out and clears its private screen', await page.evaluate(() => document.getElementById('iblist').innerHTML === ''));
  await tab2.close();
  // ---- reduced motion ----
  await page.emulateMedia({ reducedMotion: 'reduce' });
  ok('reduced motion: transitions are effectively disabled', await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('toast')).transitionDuration) < 0.01));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.fill('#au_email', email2); await page.fill('#au_pass', pass); await page.click('#au_submit'); await page.waitForSelector('#v-home:not([hidden])', { timeout: 20000 });
  await page.click('#setBtn'); await page.click('#signOut'); await page.waitForSelector('#v-welcome:not([hidden])');
  // wrong password and wide/mobile layout
  await page.fill('#au_email', email); await page.fill('#au_pass', 'wrong-password-123'); await page.click('#au_submit'); await waitFor(() => /incorrect/i.test(document.getElementById('au_msg').textContent)); ok('wrong password shows friendly error', true); await shot('11-wrong-password');
  ok('no horizontal scroll on mobile width', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(200); await shot('12-desktop-welcome');
} catch (e) { ok('E2E aborted: ' + e.message.split('\n')[0], false); await page.screenshot({ path: `${out}/zz-failure.png` }).catch(() => {}); }
ok('no page, console or CSP errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const unexpected = failedRequests.filter(x => !/^400 .*accounts:signInWithPassword$/.test(x));
ok('no unexpected failed HTTP requests (only the deliberate wrong-password 400)', unexpected.length === 0, unexpected.join(', '));
console.log(results.map(r => r.join(' ')).join('\n'));
await browser.close(); server.close();
