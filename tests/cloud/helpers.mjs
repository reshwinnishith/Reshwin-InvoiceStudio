import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import * as A from 'firebase/auth';
import * as F from 'firebase/firestore';
import { createCloud } from '../../cloud.mjs';
const core = createRequire(import.meta.url)('../../core.js');
export { A, F, core };
export const projectId = 'demo-invoice-studio-v2';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:18080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:19099') throw Error('Tests require the isolated local emulators.');
let n = 0;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(fn, what = 'condition', ms = 8000) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(40); }
  throw Error('Timed out waiting for ' + what + (last instanceof Error ? ': ' + last.message : ''));
}
export function makeClient(opts = {}, fsPort = 18080) {
  const app = initializeApp({ projectId, apiKey: 'fictional-emulator-key', authDomain: 'localhost' }, 'client-' + (++n) + '-' + Date.now());
  const auth = A.getAuth(app); A.connectAuthEmulator(auth, 'http://127.0.0.1:19099', { disableWarnings: true });
  const db = F.initializeFirestore(app, { localCache: F.memoryLocalCache() }); F.connectFirestoreEmulator(db, '127.0.0.1', fsPort);
  const cloud = createCloud({ auth, db, A, F, core, ...opts });
  return { app, auth, db, cloud, async close() { cloud.dispose(); await deleteApp(app); } };
}
// Auth emulator: fetch the pending email-verification code for an address and apply it (what clicking the email link does).
export async function verifyEmailViaEmulator(email) {
  const r = await fetch(`http://127.0.0.1:19099/emulator/v1/projects/${projectId}/oobCodes`);
  const codes = (await r.json()).oobCodes.filter(c => c.email === email && c.requestType === 'VERIFY_EMAIL');
  if (!codes.length) throw Error('no verification email recorded for ' + email);
  const res = await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:update?key=x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oobCode: codes.at(-1).oobCode }) });
  if (!res.ok) throw Error('verify failed ' + res.status);
}
export async function resetCodes(email) {
  const r = await fetch(`http://127.0.0.1:19099/emulator/v1/projects/${projectId}/oobCodes`);
  return (await r.json()).oobCodes.filter(c => c.email === email && c.requestType === 'PASSWORD_RESET');
}
export const PASSWORD = 'Fictional-Pass-1234';
export const sender = { name: 'Fictional Sender', addr: 'Example City', pan: '', type: 'Savings', bank: 'Fictional Bank', branch: 'Example', acc: '123456789', ifsc: '' };
export const client = { name: 'Fictional Client', addr: 'Client Address', pan: '', gstin: '' };
export const input = (over = {}) => core.validateInvoiceInput({ amount: '1000.00', reg: 'Fictional services', date: '2026-11-20', taxRate: 18, clientId: 'x', ...over }).value;
let u = 0;
export const freshEmail = () => `fictional-user-${Date.now()}-${++u}@example.test`;
// Sign up + verify + wait for ready. Returns { c, ws, data() }.
export async function readyUser(email = freshEmail(), opts = {}, fsPort = 18080) {
  const c = makeClient(opts, fsPort);
  await c.cloud.signUp(email, PASSWORD);
  await verifyEmailViaEmulator(email);
  await c.cloud.refreshVerification();
  await until(() => c.cloud.session.status === 'ready', 'ready session');
  let latest = null;
  const ws = c.cloud.openWorkspace(c.auth.currentUser.uid, { onData: (d, meta) => { latest = { ...d, meta }; } });
  await until(() => latest?.meta.ready, 'initial snapshot');
  return { c, ws, email, uid: c.auth.currentUser.uid, data: () => latest };
}
