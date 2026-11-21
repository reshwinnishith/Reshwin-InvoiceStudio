/* Reshwin Invoice Studio — Firebase data layer (ES module).
   The Firebase SDK namespaces are injected (`A` = firebase/auth, `F` = firebase/firestore) so the very same code runs in the
   browser (pinned CDN build) and in the Node emulator tests. No Admin SDK, no secrets, no localStorage, no persistent cache:
   a private record exists in memory only while its owner is signed in and verified.

   Write policy: every write is a Firestore transaction. Transactions need the server, so a write can never sit in an offline
   queue and "appear" later — success means the server committed it. Updates carry the `updatedAt` the user was looking at;
   a mismatch is reported as a conflict instead of silently overwriting another device's change. */
export class CloudError extends Error {
  constructor(code, message, cause) { super(message); this.name = 'CloudError'; this.code = code; this.cause = cause; }
}
const OP_TIMEOUT_MS = 20000;

export function describeAuthError(e) {
  const c = e?.code || '';
  if (c === 'auth/email-already-in-use') return 'An account with this email may already exist. Try signing in, or reset your password.';
  if (c === 'auth/invalid-email') return 'Enter a valid email address.';
  if (c === 'auth/weak-password') return 'Choose a stronger password (at least 12 characters).';
  if (c === 'auth/network-request-failed') return 'No connection. Check your internet and try again.';
  if (c === 'auth/too-many-requests') return 'Too many attempts. Please wait a few minutes before trying again.';
  if (c === 'auth/user-disabled') return 'This account has been disabled.';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(c)) return 'Email or password is incorrect.';
  if (c === 'auth/requires-recent-login') return 'Please sign in again to continue.';
  return 'Something went wrong. Please try again.';
}

export function createCloud({ auth, db, A, F, core: Core = globalThis.InvoiceCore, id = () => (globalThis.crypto?.randomUUID?.() || 'id' + Date.now() + Math.random().toString(36).slice(2)), timeoutMs = OP_TIMEOUT_MS, actionUrl = null }) {
  let session = { status: 'loading' };
  const listeners = new Set();
  let verifiedClaimFor = null;
  let lastVerificationSent = 0;
  const emit = s => { session = s; for (const l of [...listeners]) { try { l(s); } catch (e) { console.error(e); } } };

  async function resolveUser(user) {
    if (!user) { verifiedClaimFor = null; return { status: 'signedOut' }; }
    if (!user.emailVerified) { verifiedClaimFor = null; return { status: 'unverified', uid: user.uid, email: user.email }; }
    try {
      // Security rules read the `email_verified` token claim, so make sure the token we hold was minted after verification.
      if (verifiedClaimFor !== user.uid) { await user.getIdToken(true); verifiedClaimFor = user.uid; }
    } catch (e) { return { status: 'error', uid: user.uid, email: user.email, message: 'Could not confirm your session. Check your connection and retry.' }; }
    return { status: 'ready', uid: user.uid, email: user.email };
  }
  const unsubAuth = A.onAuthStateChanged(auth, async user => {
    const next = await resolveUser(user);
    if ((auth.currentUser?.uid || null) !== (user?.uid || null)) return; // a newer auth event superseded this one
    emit(next);
  });

  const withTimeout = (p, label) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new CloudError('timeout', label + ' could not be confirmed. Check the list before trying again.')), timeoutMs);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
  function mapError(e) {
    if (e instanceof CloudError) return e;
    const c = e?.code || '';
    if (c === 'unavailable' || c === 'deadline-exceeded') return new CloudError('offline', 'You appear to be offline. Nothing was saved.', e);
    if (c === 'permission-denied') return new CloudError('permission', 'This change was not allowed. Sign in again or check the details.', e);
    if (c === 'aborted' || c === 'failed-precondition') return new CloudError('conflict', 'This record changed elsewhere. Reload and try again.', e);
    if (c === 'not-found') return new CloudError('not-found', 'That record no longer exists.', e);
    if (c === 'resource-exhausted') return new CloudError('quota', 'Service is busy. Try again shortly.', e);
    return new CloudError('unknown', 'Could not save. Nothing was changed.', e);
  }

  const api = {
    get session() { return session; },
    onSession(cb) { listeners.add(cb); cb(session); return () => listeners.delete(cb); },

    async signUp(email, password) {
      const cred = await A.createUserWithEmailAndPassword(auth, email, password);
      let verificationSent = true;
      try { await A.sendEmailVerification(cred.user, actionUrl ? { url: actionUrl } : undefined); lastVerificationSent = Date.now(); } catch (e) { verificationSent = false; }
      return { verificationSent };
    },
    async signIn(email, password) { await A.signInWithEmailAndPassword(auth, email, password); },
    async signOut() { await A.signOut(auth); },
    async resendVerification({ cooldownMs = 60000 } = {}) {
      const user = auth.currentUser;
      if (!user) throw new CloudError('signed-out', 'Please sign in first.');
      const wait = cooldownMs - (Date.now() - lastVerificationSent);
      if (wait > 0) throw new CloudError('cooldown', 'Please wait ' + Math.ceil(wait / 1000) + ' seconds before requesting another email.');
      await A.sendEmailVerification(user, actionUrl ? { url: actionUrl } : undefined);
      lastVerificationSent = Date.now();
    },
    // Re-reads the account from the server so a just-clicked verification link is noticed, and refreshes the token.
    async refreshVerification() {
      const user = auth.currentUser;
      if (!user) return session;
      await user.reload();
      verifiedClaimFor = null;
      const next = await resolveUser(auth.currentUser);
      emit(next);
      return next;
    },
    // Always resolves, so the screen reveals nothing about whether an address has an account.
    async requestPasswordReset(email) {
      try { await A.sendPasswordResetEmail(auth, email, actionUrl ? { url: actionUrl } : undefined); } catch (e) {
        if (e?.code === 'auth/invalid-email') throw e;
        if (e?.code === 'auth/network-request-failed' || e?.code === 'auth/too-many-requests') throw e;
      }
    },

    /* ---- Per-account workspace ---- */
    openWorkspace(uid, handlers) {
      if (session.status !== 'ready' || session.uid !== uid || auth.currentUser?.uid !== uid) throw new CloudError('not-ready', 'Not signed in with a verified email.');
      let closed = false;
      const unsubs = [];
      const current = () => !closed && auth.currentUser?.uid === uid && session.status === 'ready' && session.uid === uid;
      const col = name => F.collection(db, 'users', uid, name);
      const ref = (name, docId) => F.doc(db, 'users', uid, name, docId);
      const data = { sender: null, clients: [], invoices: [], counter: 0 };
      const loaded = { sender: false, clients: false, invoices: false, counter: false };
      const fromCache = { sender: false, clients: false, invoices: false, counter: false };
      const push = () => {
        if (!current()) return;
        const ready = Object.values(loaded).every(Boolean);
        handlers.onData?.({ ...data, clients: [...data.clients], invoices: [...data.invoices] }, { ready, offline: Object.values(fromCache).some(Boolean) });
      };
      const fail = e => { if (current()) handlers.onError?.(mapError(e)); };
      const watch = (key, q, apply) => unsubs.push(F.onSnapshot(q, snap => {
        if (!current()) return;
        apply(snap); loaded[key] = true; fromCache[key] = !!snap.metadata?.fromCache; push();
      }, fail));
      watch('sender', ref('settings', 'sender'), s => { data.sender = s.exists() ? Core.senderFromDoc(s.data()) : null; if (data.sender) data.senderToken = s.data().updatedAt?.toMillis?.() ?? null; else data.senderToken = null; });
      watch('clients', col('clients'), s => { data.clients = s.docs.map(d => ({ ...Core.clientFromDoc(d.id, d.data()), updateToken: d.data().updatedAt?.toMillis?.() ?? null })); });
      watch('invoices', col('invoices'), s => {
        data.invoices = s.docs.map(d => Core.invoiceFromDoc(d.id, d.data())).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      });
      watch('counter', ref('counters', 'invoices'), s => { data.counter = s.exists() ? s.data().lastValue : 0; });

      const base = () => ({ ownerUid: uid, schemaVersion: Core.SCHEMA_VERSION });
      const guard = () => { if (!current()) throw new CloudError('account-changed', 'Your session changed. Please try again.'); };
      async function tx(label, fn) {
        guard();
        try {
          const result = await withTimeout(F.runTransaction(db, fn), label);
          return result;
        } catch (e) { throw mapError(e); }
      }
      const tokenOf = snap => snap.data()?.updatedAt?.toMillis?.() ?? null;
      const checkToken = (snap, expected) => {
        if (expected !== undefined && expected !== null && tokenOf(snap) !== expected) throw new CloudError('conflict', 'This record changed on another device. Reload and try again.');
      };

      const ws = {
        uid,
        close() { closed = true; while (unsubs.length) { try { unsubs.pop()(); } catch (e) { /* already closed */ } } },
        async ensureProfile(displayName) {
          const name = (displayName || 'Account').slice(0, 200) || 'Account';
          return tx('Profile', async t => {
            const r = F.doc(db, 'users', uid), s = await t.get(r);
            if (!s.exists()) t.set(r, { ...base(), displayName: name, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
          });
        },
        async saveSender(sender, expectedToken) {
          const v = Core.validateSender(sender); if (v.error) throw new CloudError('invalid', v.error);
          return tx('Your details', async t => {
            const r = ref('settings', 'sender'), s = await t.get(r);
            if (s.exists()) { checkToken(s, expectedToken); t.set(r, { ...base(), ...Core.senderToDoc(v.value), createdAt: s.data().createdAt, updatedAt: F.serverTimestamp() }); }
            else t.set(r, { ...base(), ...Core.senderToDoc(v.value), createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
          });
        },
        async saveClient(client, clientId, expectedToken) {
          const v = Core.validateClient(client); if (v.error) throw new CloudError('invalid', v.error);
          const cid = clientId || id();
          return tx('Client', async t => {
            const r = ref('clients', cid), s = await t.get(r);
            if (s.exists()) {
              if (!clientId) return cid; // idempotent retry of the same create
              checkToken(s, expectedToken);
              t.set(r, { ...base(), ...Core.clientToDoc(v.value), createdAt: s.data().createdAt, updatedAt: F.serverTimestamp() });
            } else {
              if (clientId) throw new CloudError('not-found', 'That client no longer exists.');
              t.set(r, { ...base(), ...Core.clientToDoc(v.value), createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
            }
            return cid;
          });
        },
        async deleteClient(clientId) {
          return tx('Client', async t => { t.delete(ref('clients', clientId)); });
        },
        // `input` is validated Core.validateInvoiceInput().value; client/sender are the UI-shaped records being frozen into the draft.
        async saveDraft(invoiceId, input, client, sender, expectedToken) {
          const cv = Core.validateClient(client), sv = Core.validateSender(sender);
          if (cv.error || sv.error) throw new CloudError('invalid', cv.error || sv.error);
          const iid = invoiceId || id();
          const body = Core.draftToDoc(input, { id: client.id, ...cv.value }, sv.value);
          return tx('Invoice', async t => {
            const r = ref('invoices', iid), s = await t.get(r);
            if (s.exists()) {
              if (!invoiceId) return iid;
              if (s.data().status !== 'draft') throw new CloudError('locked', 'Issued invoices cannot be edited.');
              checkToken(s, expectedToken);
              t.set(r, { ...base(), ...body, createdAt: s.data().createdAt, updatedAt: F.serverTimestamp() });
            } else {
              if (invoiceId) throw new CloudError('not-found', 'That invoice no longer exists.');
              t.set(r, { ...base(), ...body, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
            }
            return iid;
          });
        },
        async deleteDraft(invoiceId) {
          return tx('Invoice', async t => {
            const r = ref('invoices', invoiceId), s = await t.get(r);
            if (!s.exists()) return;
            if (s.data().status !== 'draft') throw new CloudError('locked', 'Only drafts can be deleted.');
            t.delete(r);
          });
        },
        // Allocates the next per-account number inside one transaction. Concurrent devices contend on the counter and retry.
        async issue(invoiceId, expectedToken) {
          const attemptIssue = () => tx('Issuing the invoice', async t => {
            const r = ref('invoices', invoiceId), c = ref('counters', 'invoices');
            const [s, cs] = await Promise.all([t.get(r), t.get(c)]);
            if (!s.exists()) throw new CloudError('not-found', 'That invoice no longer exists.');
            if (s.data().status !== 'draft') throw new CloudError('conflict', 'This invoice was already issued.');
            checkToken(s, expectedToken);
            const next = (cs.exists() ? cs.data().lastValue : 0) + 1;
            const number = Core.formatNumber(s.data().date, next);
            t.update(r, { status: 'issued', sequence: next, number, issuedAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
            t.set(c, { ownerUid: uid, lastValue: next, lastInvoiceId: invoiceId, updatedAt: F.serverTimestamp() });
            return { sequence: next, number };
          });
          // The rules validate the counter with get()/getAfter(). When another device wins the race, the backend may answer
          // permission-denied instead of aborted. Retry ONLY when a fresh server read proves that this invoice is still a draft
          // and the counter really advanced; a genuine denial never retries.
          for (let attempt = 0; ; attempt++) {
            let before = null;
            try { before = (await F.getDocFromServer(ref('counters', 'invoices'))); } catch (e) { throw mapError(e); }
            const seen = before.exists() ? before.data().lastValue : 0;
            try { return await attemptIssue(); } catch (e) {
              if (e.code !== 'permission' || attempt >= 6) throw e;
              let inv, ctr;
              try { [inv, ctr] = await Promise.all([F.getDocFromServer(ref('invoices', invoiceId)), F.getDocFromServer(ref('counters', 'invoices'))]); } catch (e2) { throw mapError(e2); }
              if (!inv.exists() || inv.data().status !== 'draft' || !ctr.exists() || ctr.data().lastValue <= seen) throw e;
            }
          }
        },
        async setStatus(invoiceId, status, expectedToken) {
          if (!['paid', 'void'].includes(status)) throw new CloudError('invalid', 'Unsupported status change.');
          return tx('Invoice', async t => {
            const r = ref('invoices', invoiceId), s = await t.get(r);
            if (!s.exists()) throw new CloudError('not-found', 'That invoice no longer exists.');
            if (!Core.canTransition(s.data().status, status)) throw new CloudError('conflict', 'This status change is not allowed.');
            checkToken(s, expectedToken);
            t.update(r, { status, [status === 'paid' ? 'paidAt' : 'voidedAt']: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
          });
        }
      };
      return ws;
    },
    dispose() { unsubAuth(); listeners.clear(); }
  };
  return api;
}
