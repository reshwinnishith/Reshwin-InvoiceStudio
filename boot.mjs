/* Loads the pinned Firebase web SDK, connects Authentication + Firestore (memory cache only, no offline persistence),
   and hands the data layer to the app. Emulator mode is available ONLY on localhost with ?emulator=1. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import * as A from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import * as F from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { createCloud, describeAuthError } from './cloud.mjs';

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const emulator = local && new URLSearchParams(location.search).get('emulator') === '1';
try {
  const config = emulator ? { projectId: 'demo-invoice-studio-v2', apiKey: 'fictional-emulator-key', authDomain: 'localhost' } : window.FIREBASE_WEB_CONFIG;
  if (!config) throw new Error('Missing Firebase configuration');
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, { localCache: F.memoryLocalCache() });
  if (emulator) {
    A.connectAuthEmulator(auth, 'http://127.0.0.1:19099', { disableWarnings: true });
    F.connectFirestoreEmulator(db, '127.0.0.1', 18080);
  }
  const cloud = createCloud({ auth, db, A, F, core: window.InvoiceCore, actionUrl: emulator ? null : location.origin + '/' });
  cloud.describeAuthError = describeAuthError;
  window.InvoiceApp.start(cloud, { emulator });
} catch (e) {
  console.error('Startup failed', e);
  window.InvoiceApp?.fatal('Could not load secure sign-in services. Check your connection and reload.');
}
