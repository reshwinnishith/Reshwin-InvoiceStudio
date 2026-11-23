// Deep user-journey test: a brand-new user's complete path plus difficult behaviour, in real Chrome against the LOCAL
// emulators only (run via `npm run test:journey`). Fictional data only. Artefacts go to the git-ignored .runtime/journey/.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, '.runtime/journey'); fs.mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const AUTH = 'http://127.0.0.1:19099', PROJECT = 'demo-invoice-studio-v2';
const prodHeaders = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers[0].headers;
const headers = Object.fromEntries(prodHeaders.map(h => [h.key, h.key === 'Content-Security-Policy' ? h.value.replace('connect-src ', 'connect-src http://127.0.0.1:19099 http://127.0.0.1:18080 ') : h.value]));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'); const f = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(root) || /firebase-preparation|node_modules|\.runtime/.test(f) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { ...headers, 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(5174, '127.0.0.1');
const URL0 = 'http://127.0.0.1:5174/?emulator=1';

const results = []; let step = 'start';
const ok = (n, c, extra = '') => { results.push([c ? 'PASS' : 'FAIL', n + (extra ? ' — ' + extra : '')]); if (!c) process.exitCode = 1; };
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const errors = [];
let dialogAnswer = true; const dialogs = [];
function instrument(p, label) {
  p.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
  p.on('console', m => { // The Firestore SDK's connectivity probe (google.com cleardot.gif) is blocked by img-src while offline: harmless, deliberately not allowed.
    if (m.type() === 'error' && !/Failed to load resource|PDF (share|download) failed|cleardot\.gif/.test(m.text())) errors.push(label + ' console: ' + m.text()); });
  p.on('dialog', d => { dialogs.push(d.message()); return dialogAnswer ? d.accept() : d.dismiss(); });
}
const page = await ctx.newPage(); instrument(page, 'A');
async function waitFor(p, fn, arg, { timeout = 15000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await p.evaluate(fn, arg)) return true; }
    catch (e) { if (!/Execution context was destroyed|Cannot find context/.test(e.message)) throw e; }
    await p.waitForTimeout(100);
  }
  throw new Error('timeout waiting for ' + fn.toString().slice(0, 100));
}
const toastIs = (p, re) => waitFor(p, r => new RegExp(r, 'i').test(document.getElementById('toast').textContent) && document.getElementById('toast').classList.contains('show'), re.source);
const visible = p => p.evaluate(() => [...document.querySelectorAll('section[id^=v-]')].filter(s => !s.hidden).map(s => s.id).join());
const shot = async (n, p = page) => { await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${n}.png`, fullPage: true }); };
async function oob(email, type) {
  const r = await (await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  return r.oobCodes.filter(x => x.email === email && x.requestType === type).at(-1)?.oobCode;
}
async function verifyEmail(email) {
  const code = await oob(email, 'VERIFY_EMAIL');
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:update?key=x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oobCode: code }) });
}
async function signUp(p, email, pass) {
  await p.click('#au_tab_up'); await p.fill('#au_email', email); await p.fill('#au_pass', pass); await p.fill('#au_pass2', pass); await p.click('#au_submit');
  await p.waitForSelector('#v-verify:not([hidden])');
  await verifyEmail(email); await p.click('#vf_check'); await p.waitForSelector('#v-home:not([hidden])', { timeout: 20000 });
}
async function signOut(p) { await p.click('#setBtn'); await p.click('#signOut'); await p.waitForSelector('#v-welcome:not([hidden])', { timeout: 20000 }); await p.waitForTimeout(800); }
async function addClient(p, name, addr, extra = {}) {
  await p.click('#navClients'); await p.click('#addClient'); await p.waitForSelector('#v-client-edit:not([hidden])');
  await p.fill('#ce_name', name); await p.fill('#ce_addr', addr); if (extra.pan) await p.fill('#ce_pan', extra.pan); if (extra.gstin) await p.fill('#ce_gstin', extra.gstin);
  await p.click('#ce_save'); await waitFor(p, n => [...document.querySelectorAll('#clientList .in')].some(e => e.textContent === n), name);
  await p.click('#backBtn'); await p.waitForSelector('#v-home:not([hidden])');
}
async function newDraft(p, { client, reg, amt, tax = '0' }) {
  await goHome(p); await p.click('#fab'); await p.waitForSelector('#v-generate:not([hidden])');
  if (client) await p.selectOption('#g_client', { label: client });
  await p.fill('#g_reg', reg); await p.fill('#g_amt', amt); await p.selectOption('#g_tax', tax); await p.click('#g_go');
  await draftShown(p, reg);
}
// The invoice view keeps its previous markup while hidden, so wait for THIS draft to be on a visible invoice screen.
const draftShown = (p, text) => waitFor(p, t => !document.getElementById('v-invoice').hidden && document.getElementById('invoiceStatus').textContent === 'Draft' && document.getElementById('paper').textContent.includes(t), text, { timeout: 20000 });
const paperText = p => p.textContent('#paper');
const goHome = async p => { for (let i = 0; i < 4 && !(await p.isVisible('#v-home')); i++) await p.click('#backBtn'); await p.waitForSelector('#v-home:not([hidden])'); };
const stamp = Date.now(), pass = 'Fictional-Pass-1234', emailA = `journey-a-${stamp}@example.test`, emailB = `journey-b-${stamp}@example.test`;

try {
  await page.goto(URL0); await page.waitForSelector('#v-welcome:not([hidden])', { timeout: 20000 });
  // ---------- 1. sign-up validation ----------
  step = '1. sign-up validation';
  await page.click('#au_tab_up');
  for (const [email, p1, p2, re, label] of [
    ['not-an-email', pass, pass, /valid email/, 'invalid email'], [emailA, 'short', 'short', /at least 8/, 'short password'],
    [emailA, pass, pass + 'x', /do not match/, 'mismatched passwords'], [emailA, '', '', /Enter your password/, 'empty password']]) {
    await page.fill('#au_email', email); await page.fill('#au_pass', p1); await page.fill('#au_pass2', p2); await page.click('#au_submit');
    ok(`sign-up: ${label} is refused with a clear message`, re.test(await page.textContent('#au_msg')) && (await visible(page)) === 'v-welcome', await page.textContent('#au_msg'));
  }
  await signUp(page, emailA, pass);
  ok('new account A reaches an empty home after verification', /^0 invoices/.test(await page.textContent('#ibcount')));
  await shot('01-home-empty');
  // ---------- 2. editor before details/clients ----------
  step = '2. editor before details/clients';
  await page.click('#fab'); await page.waitForSelector('#v-generate:not([hidden])');
  ok('editor without clients: Create is disabled and explains why', await page.isDisabled('#g_go') && /Add a client first/.test(await page.textContent('#g_client')));
  await page.click('#backBtn');
  // ---------- 3. details validation + save ----------
  step = '3. details validation + save';
  await page.click('#navDetails'); await page.fill('#f_name', 'Fictional Sender Studio'); await page.fill('#f_addr', '12 Example Lane\nExample City 560001');
  await page.fill('#f_pan', 'BADPAN'); await page.click('#f_save'); await toastIs(page, /PAN format/); ok('details: invalid PAN refused', (await visible(page)) === 'v-details');
  await page.fill('#f_pan', 'ABCDE1234F'); await page.fill('#f_ifsc', 'abcd0123456'); await page.fill('#f_acc', '1234567890'); await page.fill('#f_bank', 'Fictional Bank');
  await page.click('#f_save'); await toastIs(page, /Details saved/); ok('details: valid details saved (IFSC upper-cased)', true);
  await page.click('#navDetails'); ok('details: IFSC stored normalised to upper case', (await page.inputValue('#f_ifsc')) === 'ABCD0123456'); await page.click('#backBtn');
  // ---------- 4. clients: add several, long names, edit, remove ----------
  step = '4. clients: add several, long names, edit, remove';
  const longName = 'Fictional ' + 'Very Long Client Name '.repeat(9).trim(); // ~200 chars
  await addClient(page, 'Alpha Fictional Pvt Ltd', 'Alpha Road\nExample City');
  await addClient(page, longName.slice(0, 200), ('Long address line '.repeat(12) + '\n').repeat(3).trim());
  await addClient(page, 'Zeta Fictional Traders', 'Zeta Street', { pan: 'ABCDE1234F', gstin: '29ABCDE1234F1Z5' });
  await page.click('#navClients'); ok('clients: three clients listed alphabetically', (await page.textContent('#clientCount')) === '3 clients' && (await page.textContent('#clientList .in >> nth=0')) === 'Alpha Fictional Pvt Ltd');
  await shot('02-clients');
  await page.click('#addClient'); await page.fill('#ce_name', '   '); await page.click('#ce_save'); await toastIs(page, /client name/); ok('clients: blank (spaces-only) name refused', true);
  await page.fill('#ce_name', ''); await page.type('#ce_name', 'X'.repeat(205), { delay: 0 }); ok('clients: name field stops at 200 characters', (await page.inputValue('#ce_name')).length === 200);
  await page.fill('#ce_name', 'Mismatch'); await page.fill('#ce_pan', 'ABCDE1234F'); await page.fill('#ce_gstin', '29PQRST1234F1Z5'); await page.click('#ce_save'); await toastIs(page, /must match/); ok('clients: GSTIN/PAN mismatch refused', true);
  dialogAnswer = false; await page.click('#backBtn'); ok('clients: leaving a form with unsaved text asks first and stays when cancelled', (await visible(page)) === 'v-client-edit' && dialogs.at(-1).includes('Discard'));
  dialogAnswer = true; await page.click('#backBtn'); await page.waitForSelector('#v-clients:not([hidden])');
  await page.click('#clientList .clientrow >> nth=0'); await page.click('#viewEditClient'); await page.fill('#ce_name', 'Alpha Fictional Private Limited'); await page.click('#ce_save');
  await waitFor(page, () => [...document.querySelectorAll('#clientList .in')].some(e => e.textContent === 'Alpha Fictional Private Limited')); ok('clients: edit saved', true);
  await page.click('#backBtn');
  // ---------- 5. money validation in the editor ----------
  step = '5. money validation in the editor';
  await page.click('#fab'); await page.waitForSelector('#v-generate:not([hidden])'); await page.selectOption('#g_client', { label: 'Zeta Fictional Traders' }); await page.fill('#g_reg', 'Fictional consulting');
  for (const bad of ['', '0', '-5', '1,000', '12.345', 'abc', '100000000.01', '1e5']) {
    await page.fill('#g_amt', bad); await page.click('#g_go'); await toastIs(page, /amount/);
  }
  ok('editor: empty, zero, negative, comma, 3-decimal, text, over-₹10-crore and exponent amounts are all refused', (await visible(page)) === 'v-generate');
  await page.fill('#g_amt', '12345.67'); await page.fill('#g_reg', '   '); await page.click('#g_go'); await toastIs(page, /Describe the work/); ok('editor: blank description refused', true);
  await page.fill('#g_reg', 'Fictional consulting — November'); await page.selectOption('#g_tax', '18'); await page.fill('#g_date', '2026-12-31');
  const before = dialogs.length; await page.click('#g_go');
  await draftShown(page, 'Fictional consulting');
  ok('editor: GST asks the user to confirm entitlement before saving', dialogs.slice(before).some(d => /entitled to charge GST/.test(d)));
  // 1234567 paise @18% -> tax floor((1234567*18+50)/100) = 222222 paise; total 1456789
  let t = await paperText(page);
  ok('draft: subtotal, GST 18%, grand total and words are exact', t.includes('₹12,345.67') && t.includes('₹2,222.22') && t.includes('₹14,567.89') && /Fourteen Thousand Five Hundred Sixty Seven and Eighty Nine Paise/.test(t), t.match(/₹[\d,.]+/g)?.join(' '));
  ok('draft: no number until issued', t.includes('Assigned when issued'));
  await shot('03-draft-gst');
  // ---------- 6. reload persistence, then edit the draft ----------
  step = '6. reload persistence, then edit the draft';
  await page.reload(); await page.waitForSelector('#v-home:not([hidden])', { timeout: 20000 }); await waitFor(page, () => document.querySelectorAll('#iblist .inv').length === 1);
  ok('reload: session restored and draft persisted', /Zeta Fictional Traders/.test(await page.textContent('#iblist')));
  await page.click('#iblist .inv'); await page.click('#editInv'); await page.waitForSelector('#v-generate:not([hidden])');
  ok('edit draft: editor prefilled with saved values', (await page.inputValue('#g_amt')) === '12345.67' && (await page.inputValue('#g_tax')) === '18' && (await page.inputValue('#g_date')) === '2026-12-31');
  await page.fill('#g_amt', '0.99'); await page.selectOption('#g_tax', '5'); await page.click('#g_go');
  await waitFor(page, () => /₹0\.99/.test(document.getElementById('paper').textContent));
  t = await paperText(page); // 99 paise @5% -> floor((495+50)/100)=5 paise; total 104
  ok('edit draft: rounding boundary 99 paise @5% = 5 paise GST, total ₹1.04', t.includes('₹0.05') && t.includes('₹1.04') && /One and Four Paise/.test(t));
  // ---------- 7. rapid repeated taps on Create draft ----------
  step = '7. rapid repeated taps on Create draft';
  await goHome(page);
  await page.click('#fab'); await page.waitForSelector('#v-generate:not([hidden])'); await page.selectOption('#g_client', { label: 'Alpha Fictional Private Limited' });
  await page.fill('#g_reg', 'Fictional rapid-tap job'); await page.fill('#g_amt', '500'); await page.selectOption('#g_tax', '0');
  await page.evaluate(() => { const b = document.getElementById('g_go'); for (let i = 0; i < 5; i++) b.click(); });
  await draftShown(page, 'rapid-tap');
  await goHome(page); await page.waitForTimeout(800);
  ok('rapid taps: five taps on Create draft create exactly one draft', (await page.$$eval('#iblist .inv', els => els.filter(e => e.textContent.includes('Alpha Fictional')).length)) === 1);
  // ---------- 7b. leaving the editor while a save is still in flight ----------
  step = '7b. leave editor during save';
  await page.click('#fab'); await page.waitForSelector('#v-generate:not([hidden])'); await page.selectOption('#g_client', { label: 'Alpha Fictional Private Limited' });
  await page.fill('#g_reg', 'Fictional left-during-save job'); await page.fill('#g_amt', '321'); await page.selectOption('#g_tax', '0');
  await page.evaluate(() => { document.getElementById('g_go').click(); document.getElementById('backBtn').click(); });
  await waitFor(page, () => document.getElementById('iblist').textContent.includes('₹321.00'), null, { timeout: 20000 }); await page.waitForTimeout(1200);
  ok('save in flight: leaving the editor keeps you where you went; the draft is still saved once', (await visible(page)) === 'v-home'
    && (await page.$$eval('#iblist .inv', els => els.filter(e => e.textContent.includes('Alpha')).length)) === 2, await visible(page));
  // ---------- 8. draft whose client was removed ----------
  step = '8. draft whose client was removed';
  await addClient(page, 'Temporary Fictional Client', 'Temp Road');
  await newDraft(page, { client: 'Temporary Fictional Client', reg: 'Fictional job for a removed client', amt: '750' });
  await goHome(page); await page.click('#navClients');
  await page.click('#clientList .clientrow:has-text("Temporary Fictional Client")'); await page.click('#viewEditClient'); await page.click('#ce_delete');
  await waitFor(page, () => !document.getElementById('clientList').textContent.includes('Temporary Fictional Client')); await goHome(page);
  await page.click('#iblist .inv:has-text("Temporary Fictional Client")'); await page.click('#editInv'); await page.waitForSelector('#v-generate:not([hidden])');
  const sel = await page.evaluate(() => { const s = document.getElementById('g_client'); return { value: s.value, label: s.selectedOptions[0]?.textContent || '' }; });
  ok('removed client: editing its draft does not silently switch to another client', sel.value === '' || /Temporary Fictional Client/.test(sel.label), JSON.stringify(sel));
  await page.click('#g_go'); await page.waitForTimeout(600);
  ok('removed client: saving without choosing a client is refused', (await visible(page)) === 'v-generate' && /client/i.test(await page.textContent('#toast')));
  dialogAnswer = true; await goHome(page);
  // ---------- 8b. details changed after the draft was saved ----------
  step = '8b. stale snapshot warning';
  await newDraft(page, { client: 'Alpha Fictional Private Limited', reg: 'Fictional snapshot job', amt: '654' });
  await goHome(page); await page.click('#navDetails'); await page.fill('#f_acc', '9876543210'); await page.click('#f_save'); await toastIs(page, /Details saved/);
  await page.click('#iblist .inv:has-text("₹654.00")'); dialogAnswer = false; const d0 = dialogs.length; await page.click('#issueInv'); await page.waitForTimeout(400); dialogAnswer = true;
  ok('issue: warns when Your Details changed after the draft was saved, and cancelling issues nothing', /Your Details changed since this draft was saved/.test(dialogs.slice(d0).join(' ')) && (await page.textContent('#invoiceStatus')) === 'Draft');
  await page.click('#editInv'); await page.click('#g_go'); await draftShown(page, 'snapshot job');
  ok('editing and saving the draft picks up the current details', /9876543210/.test(await paperText(page)));
  const d1 = dialogs.length; dialogAnswer = false; await page.click('#issueInv'); await page.waitForTimeout(400); dialogAnswer = true;
  ok('issue: no stale-details warning once the draft is up to date', dialogs.length > d1 && !/changed since/.test(dialogs.slice(d1).join(' ')));
  await page.click('#deleteInv'); await waitFor(page, () => !document.getElementById('v-home').hidden);
  await page.click('#navDetails'); await page.fill('#f_acc', '1234567890'); await page.click('#f_save'); await toastIs(page, /Details saved/);
  // ---------- 9. issue, numbering, paid/void ----------
  step = '9. issue, numbering, paid/void';
  await page.click('#iblist .inv:has-text("Zeta")'); await page.click('#issueInv'); await page.waitForSelector('#issueSheet:not([hidden])', { timeout: 20000 });
  ok('issue: number uses the invoice-date year (2026-12-31 → RESH-2026-001)', (await page.textContent('#is_num')) === 'RESH-2026-001', await page.textContent('#is_num'));
  await page.keyboard.press('Escape'); await waitFor(page, () => document.getElementById('issueSheet').hidden);
  ok('issue: issued invoice offers no Edit or Delete', await page.evaluate(() => document.getElementById('editInv').hidden && document.getElementById('deleteInv').hidden));
  await page.click('#paidInv'); await waitFor(page, () => document.getElementById('invoiceStatus').textContent === 'Paid');
  ok('paid: Void is no longer offered for a paid invoice', await page.isHidden('#voidInv') && await page.isHidden('#paidInv'));
  await goHome(page); await page.click('#iblist .inv:has-text("₹500.00")'); await page.click('#issueInv'); await page.waitForSelector('#issueSheet:not([hidden])', { timeout: 20000 });
  ok('issue: second invoice gets RESH-2026-002', /RESH-\d{4}-002/.test(await page.textContent('#is_num')), await page.textContent('#is_num')); await page.click('#is_done');
  await page.click('#voidInv'); await waitFor(page, () => document.getElementById('invoiceStatus').textContent === 'Void');
  ok('void: title shows Void and the number is kept', /Invoice — Void/.test(await paperText(page)) && /RESH-\d{4}-002/.test(await paperText(page)));
  // ---------- 10. PDF download and saved totals agree ----------
  step = '10. PDF download and saved totals agree';
  await goHome(page); await page.click('#iblist .inv:has-text("Zeta")'); await page.waitForSelector('#paper .p-nm');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#dl')]);
  const pdfPath = path.join(out, 'journey-' + dl.suggestedFilename()); await dl.saveAs(pdfPath);
  ok('PDF: file named after the invoice number', dl.suggestedFilename() === 'RESH-2026-001.pdf', dl.suggestedFilename());
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), disableFontFace: true }).promise;
  const pdfText = (await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1).then(p => p.getTextContent())))).flatMap(c => c.items.map(i => i.str)).join(' ');
  ok('PDF: amounts match the screen (1.04 total, 0.05 GST, 0.99 subtotal) and number present', /RESH-2026-001/.test(pdfText) && /1\.04/.test(pdfText) && /0\.05/.test(pdfText) && /0\.99/.test(pdfText) && /One and Four Paise/.test(pdfText), pdfText.slice(0, 160));
  // ---------- 11. stale edit from a second tab ----------
  step = '11. stale edit from a second tab';
  await newDraft(page, { client: 'Zeta Fictional Traders', reg: 'Fictional two-tab draft', amt: '100' });
  const tab2 = await ctx.newPage(); instrument(tab2, 'A2'); await tab2.goto(URL0); await tab2.waitForSelector('#v-home:not([hidden])', { timeout: 20000 });
  await waitFor(tab2, () => document.getElementById('iblist').textContent.includes('₹100.00'));
  await tab2.click('#iblist .inv:has-text("₹100.00")'); await tab2.click('#editInv'); await tab2.waitForSelector('#v-generate:not([hidden])');
  await page.click('#editInv'); await page.waitForSelector('#v-generate:not([hidden])'); await page.fill('#g_amt', '200'); await page.click('#g_go');
  await waitFor(page, () => /₹200\.00/.test(document.getElementById('paper').textContent));
  await tab2.fill('#g_amt', '300'); await tab2.click('#g_go'); await toastIs(tab2, /changed (on another device|elsewhere)/);
  ok('two tabs: stale draft save is reported as a conflict, newer save survives', (await visible(tab2)) === 'v-generate');
  await page.waitForTimeout(500); ok('two tabs: the first tab still shows ₹200.00', /₹200\.00/.test(await paperText(page)));
  // stale delete
  dialogAnswer = false; await tab2.click('#backBtn'); dialogAnswer = true; await tab2.click('#backBtn');
  await goHome(tab2); await waitFor(tab2, () => document.getElementById('iblist').textContent.includes('₹200.00')); await tab2.click('#iblist .inv:has-text("₹200.00")');
  await page.click('#editInv'); await page.fill('#g_amt', '250'); await page.click('#g_go'); await waitFor(page, () => /₹250\.00/.test(document.getElementById('paper').textContent));
  await tab2.waitForTimeout(400); await tab2.click('#deleteInv'); await tab2.waitForTimeout(1200);
  ok('two tabs: after the other tab updated it, a delete either conflicts or acts on the refreshed record (no silent loss of a stale view)',
    /changed|deleted/i.test(await tab2.textContent('#toast')), await tab2.textContent('#toast'));
  // concurrent issue of two drafts from two tabs
  await goHome(page); await goHome(tab2);
  await newDraft(page, { client: 'Zeta Fictional Traders', reg: 'Fictional concurrent one', amt: '11' }); await goHome(page);
  await newDraft(page, { client: 'Zeta Fictional Traders', reg: 'Fictional concurrent two', amt: '22' }); await goHome(page);
  await waitFor(tab2, () => document.getElementById('iblist').textContent.includes('₹22.00'));
  await page.click('#iblist .inv:has-text("₹11.00")'); await tab2.click('#iblist .inv:has-text("₹22.00")');
  await Promise.all([page.click('#issueInv'), tab2.click('#issueInv')]);
  await Promise.all([page.waitForSelector('#issueSheet:not([hidden])', { timeout: 30000 }), tab2.waitForSelector('#issueSheet:not([hidden])', { timeout: 30000 })]);
  const nums = [await page.textContent('#is_num'), await tab2.textContent('#is_num')].sort();
  ok('two tabs issuing at the same moment receive distinct consecutive numbers', new Set(nums).size === 2 && nums.every(n => /^RESH-2026-00[34]$/.test(n)), nums.join(','));
  await page.click('#is_done'); await tab2.click('#is_done'); await tab2.close();
  // ---------- 12. offline ----------
  step = '12. offline';
  await goHome(page); await ctx.setOffline(true); await page.waitForTimeout(1500);
  await page.click('#fab'); await page.selectOption('#g_client', { index: 0 }); await page.fill('#g_reg', 'Fictional offline attempt'); await page.fill('#g_amt', '42'); await page.selectOption('#g_tax', '0'); await page.click('#g_go');
  await toastIs(page, /offline/); ok('offline: save is refused and says nothing was saved', (await visible(page)) === 'v-generate');
  await ctx.setOffline(false); await waitFor(page, () => document.getElementById('netBanner').hidden, null, { timeout: 20000 });
  await page.click('#g_go'); await waitFor(page, () => !!document.querySelector('#paper .p-nm') && /42\.00/.test(document.getElementById('paper').textContent), null, { timeout: 20000 });
  ok('offline: after reconnecting the same save succeeds once', true);
  // ---------- 13. account isolation ----------
  step = '13. account isolation';
  await goHome(page); await signOut(page);
  ok('logout: no private data remains in the DOM', !(await page.content()).includes('Zeta Fictional'));
  await page.goBack().catch(() => {}); await page.waitForTimeout(1000);
  ok('browser Back after logout shows no private screen', !(await page.content()).includes('Zeta Fictional'), await visible(page));
  await page.goto(URL0); await page.waitForSelector('#v-welcome:not([hidden])', { timeout: 20000 });
  await signUp(page, emailB, pass);
  ok('account B: empty workspace, none of A\'s clients/invoices/details', /^0 invoices/.test(await page.textContent('#ibcount')) && !(await page.content()).includes('Zeta'));
  await page.click('#navDetails'); ok('account B: Your Details form is empty', (await page.inputValue('#f_name')) === ''); await page.click('#backBtn');
  await page.click('#navClients'); ok('account B: no clients', (await page.textContent('#clientCount')) === '0 clients'); await page.click('#backBtn');
  await signOut(page);
  // ---------- 14. password reset and session restoration ----------
  step = '14. password reset and session restoration';
  await page.click('#au_forgot'); await page.fill('#rs_email', 'nobody-' + stamp + '@example.test'); await page.click('#rs_submit');
  await waitFor(page, () => /If an account exists/.test(document.getElementById('rs_msg').textContent)); const unknownMsg = await page.textContent('#rs_msg');
  await page.fill('#rs_email', emailA); await page.click('#rs_submit'); await page.waitForTimeout(800);
  ok('reset: unknown and real addresses get the identical message', unknownMsg === await page.textContent('#rs_msg'));
  const resetCode = await oob(emailA, 'PASSWORD_RESET'); const newPass = 'Fictional-New-Pass-5678';
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oobCode: resetCode, newPassword: newPass }) });
  await page.click('#rs_back'); await page.fill('#au_email', emailA); await page.fill('#au_pass', pass); await page.click('#au_submit');
  await waitFor(page, () => /incorrect/i.test(document.getElementById('au_msg').textContent)); ok('reset: old password no longer works', true);
  await page.fill('#au_pass', newPass); await page.click('#au_submit'); await page.waitForSelector('#v-home:not([hidden])', { timeout: 20000 });
  ok('reset: new password signs in to the same workspace', /Zeta/.test(await page.textContent('#iblist')));
  await page.reload(); await page.waitForSelector('#v-home:not([hidden])', { timeout: 20000 }); ok('session restored after reload with the new password session', true);
  await shot('04-home-final');
  // ---------- 15. layout + accessibility sweep on every signed-in screen at five widths ----------
  step = '15. layout sweep';
  const audit = () => page.evaluate(() => {
    const vw = window.innerWidth, vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden'; };
    const scope = [...document.querySelectorAll('section[id^=v-]:not([hidden]), #bar, #fab')];
    const all = scope.flatMap(s => [s, ...s.querySelectorAll('*')]).filter(vis);
    const overflow = all.filter(e => !e.closest('#stage') && e.getBoundingClientRect().right > vw + 1 && getComputedStyle(e).position !== 'fixed').map(e => e.id || e.className || e.tagName);
    const controls = all.filter(e => e.matches('button,a[href],input,select,textarea,[role=tab]'));
    const nameless = controls.filter(e => !(e.getAttribute('aria-label') || e.textContent.trim() || e.labels?.length || e.title)).map(e => e.id || e.outerHTML.slice(0, 40));
    const small = controls.filter(e => e.matches('button,a[href],[role=tab]')).filter(e => { const r = e.getBoundingClientRect(); return r.height < 40 || r.width < 40; }).map(e => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
    const clipped = all.filter(e => e.matches('.in,.isub,.cn,.num,.amt,h2,button') && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis' && getComputedStyle(e).overflow === 'hidden').map(e => e.id || e.className);
    return { scroll: document.documentElement.scrollWidth <= vw, overflow: [...new Set(overflow)].slice(0, 4), nameless, small: [...new Set(small)], clipped };
  });
  const screens = [
    ['home', async () => {}],
    ['clients', async () => page.click('#navClients')],
    ['client', async () => { await page.click('#navClients'); await page.click('#clientList .clientrow >> nth=1'); }],
    ['client-edit', async () => { await page.click('#navClients'); await page.click('#addClient'); await page.waitForSelector('#v-client-edit:not([hidden])'); }],
    ['details', async () => page.click('#navDetails')],
    ['editor', async () => { await page.click('#fab'); await page.waitForSelector('#v-generate:not([hidden])'); }],
    ['invoice', async () => { await page.click('#iblist .inv >> nth=0'); await page.waitForSelector('#paper .p-nm'); }],
    ['settings', async () => page.click('#setBtn')],
  ];
  const smallSeen = new Set();
  for (const width of [320, 375, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: width < 700 ? 760 : 900 });
    for (const [name, open] of screens) {
      await page.goto(URL0); await page.waitForSelector('#v-home:not([hidden])', { timeout: 20000 }); await waitFor(page, () => document.querySelectorAll('#iblist .inv').length > 0);
      await open(); await page.waitForTimeout(350);
      const r = await audit(); r.small.forEach(x => smallSeen.add(name + '@' + width + ' ' + x));
      ok(`${width}px ${name}: no horizontal overflow or clipped text`, r.scroll && !r.overflow.length && !r.clipped.length, [...r.overflow, ...r.clipped].join(','));
      ok(`${width}px ${name}: every control has an accessible name`, !r.nameless.length, r.nameless.join(','));
      if ([320, 768, 1280].includes(width)) await shot(`layout-${width}-${name}`);
    }
  }
  console.log('OBSERVE small (<40px) touch targets: ' + ([...smallSeen].join(' | ') || 'none'));
  // keyboard: Tab order on home reaches the filters, invoices, Details, + and Clients, each with a visible focus indicator
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(URL0); await page.waitForSelector('#v-home:not([hidden])', { timeout: 20000 });
  const order = []; for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => { const e = document.activeElement; if (e === document.body) return 'BODY'; const cs = getComputedStyle(e); return (e.id || e.className) + (cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' ? '' : '[no-focus-ring]'); })); }
  ok('keyboard: Tab from the screen heading reaches filters, invoices, Details, + and Clients', ['flt_all', 'navDetails', 'fab', 'navClients'].every(x => order.some(o => o.startsWith(x))) && order.some(o => o.startsWith('inv')), order.join(' '));
  await page.click('#iblist .inv:has-text("Draft")').catch(() => page.click('#iblist .inv >> nth=0')); await page.waitForSelector('#paper .p-nm');
  if (await page.isVisible('#deleteInv')) { await page.focus('#deleteInv'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    ok('keyboard: Delete draft shows a focus ring and is at least 44px tall', await page.evaluate(() => { const e = document.getElementById('deleteInv'); return document.activeElement === e && getComputedStyle(e).outlineStyle !== 'none' && e.getBoundingClientRect().height >= 44; })); }
  ok('keyboard: every focused control shows a focus indicator', !order.some(o => o.includes('[no-focus-ring]')), order.filter(o => o.includes('no-focus')).join(' '));
} catch (e) { ok('Journey aborted in step [' + step + ']: ' + e.message.split('\n')[0] + ' ' + (e.message.match(/waiting for (locator\([^)]*\))/)?.[1] || ''), false); await page.screenshot({ path: `${out}/zz-failure.png` }).catch(() => {}); }
ok('no page, console or CSP errors during the journey', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.map(r => r.join(' ')).join('\n'));
console.log(`${results.filter(r => r[0] === 'PASS').length} passed, ${results.filter(r => r[0] === 'FAIL').length} failed`);
await browser.close(); server.close();
