import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloud, describeEmailSendError, describeAuthError } from '../../cloud.mjs';
// Stub SDK: no network, no emulator. Verifies the sign-up / verification-email contract.
function make({ send, create, actionUrl = 'https://prod.example/' } = {}) {
  const calls = { send: [], create: 0 };
  const user = { uid: 'u1', email: 'x@example.test', emailVerified: false };
  const A = {
    onAuthStateChanged: () => () => {},
    createUserWithEmailAndPassword: async () => { calls.create++; if (create) throw create; return { user }; },
    sendEmailVerification: async (u, s) => { calls.send.push(s); if (send) return send(s, calls.send.length); },
  };
  const auth = { get currentUser() { return user; } };
  return { cloud: createCloud({ auth, db: {}, A, F: {}, core: {}, actionUrl }), calls };
}
test('account creation succeeds even when the verification email fails, and the real error code is preserved', async () => {
  for (const code of ['auth/too-many-requests', 'auth/network-request-failed', 'auth/internal-error', 'auth/operation-not-allowed']) {
    const { cloud, calls } = make({ send: () => { throw { code }; } });
    const r = await cloud.signUp('x@example.test', 'Fictional-Pass-1');
    assert.deepEqual(r, { verificationSent: false, errorCode: code }); assert.equal(calls.create, 1, 'account created exactly once');
  }
});
test('an invalid continue URL is retried once without it so the email still goes out', async () => {
  const { cloud, calls } = make({ send: (s, n) => { if (s) throw { code: 'auth/unauthorized-continue-uri' }; } });
  assert.deepEqual(await cloud.signUp('x@example.test', 'Fictional-Pass-1'), { verificationSent: true, errorCode: null });
  assert.deepEqual(calls.send, [{ url: 'https://prod.example/' }, undefined]);
});
test('without a configured continue URL nothing is attached; a continue-URL error with no fallback is reported', async () => {
  const a = make({ actionUrl: null }); await a.cloud.signUp('x@example.test', 'Fictional-Pass-1'); assert.deepEqual(a.calls.send, [undefined]);
  const b = make({ actionUrl: null, send: () => { throw { code: 'auth/unauthorized-continue-uri' }; } });
  assert.equal((await b.cloud.signUp('x@example.test', 'Fictional-Pass-1')).errorCode, 'auth/unauthorized-continue-uri');
});
test('a failed first send does not start the resend cooldown; a successful one does', async () => {
  let fail = true; const { cloud } = make({ send: () => { if (fail) throw { code: 'auth/network-request-failed' }; } });
  await cloud.signUp('x@example.test', 'Fictional-Pass-1');
  fail = false; await cloud.resendVerification();                       // allowed immediately: nothing was delivered yet
  await assert.rejects(cloud.resendVerification(), e => e.code === 'cooldown');
});
test('resend surfaces rate limits and offline errors with their real codes', async () => {
  for (const code of ['auth/too-many-requests', 'auth/network-request-failed']) {
    const { cloud } = make({ send: () => { throw { code }; } }); cloud;
    await assert.rejects(cloud.resendVerification({ cooldownMs: 0 }), e => e.code === code);
  }
});
test('registering an existing address surfaces email-already-in-use (the app then tries to sign in)', async () => {
  const { cloud } = make({ create: { code: 'auth/email-already-in-use' } });
  await assert.rejects(cloud.signUp('x@example.test', 'Fictional-Pass-1'), e => e.code === 'auth/email-already-in-use');
});
test('user-facing messages are actionable and never contain addresses or tokens', () => {
  for (const code of ['auth/too-many-requests', 'auth/network-request-failed', 'auth/unauthorized-continue-uri', 'auth/invalid-email', 'auth/internal-error', undefined]) {
    const m = describeEmailSendError({ code }); assert.ok(m.length > 20 && !/@|http|oob/i.test(m), m);
  }
  assert.match(describeAuthError({ code: 'auth/weak-password' }), /8 characters/);
});
