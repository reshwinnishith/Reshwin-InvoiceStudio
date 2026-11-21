import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloud } from '../../cloud.mjs';
// Pure stubs: no emulator needed.
const mk = (fn, actionUrl) => createCloud({ auth: {}, db: {}, A: { onAuthStateChanged: () => () => {}, sendPasswordResetEmail: fn }, F: {}, core: {}, actionUrl });
test('password reset: unknown address looks like success, every other failure is surfaced', async () => {
  await mk(async () => { throw { code: 'auth/user-not-found' }; }).requestPasswordReset('x@example.test');
  for (const code of ['auth/unauthorized-continue-uri', 'auth/network-request-failed', 'auth/too-many-requests', 'auth/invalid-email', 'auth/internal-error'])
    await assert.rejects(mk(async () => { throw { code }; }).requestPasswordReset('x@example.test'), e => e.code === code);
});
test('continue URL is only sent when configured (production host only)', async () => {
  const seen = []; const fn = async (a, e, s) => { seen.push(s); };
  await mk(fn, null).requestPasswordReset('x@example.test'); await mk(fn, 'https://reshwin-invoicestudio.vercel.app/').requestPasswordReset('x@example.test');
  assert.deepEqual(seen, [undefined, { url: 'https://reshwin-invoicestudio.vercel.app/' }]);
});
