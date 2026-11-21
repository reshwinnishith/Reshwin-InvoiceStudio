# Invoice Studio V2 — Firebase accounts, sync and security

**Status: developed and tested locally against the Firebase emulators only. Nothing is deployed.**
Production Firestore (`partypulse-d8ad3`, default database) still uses the deny-all ruleset
`8ac4ed17-8894-4903-9418-d6b9612c7b67`. `firestore.rules` in this repository is **not** live; deploying it needs a separate release approval.

## What V2 does
- Email/password sign-up and sign-in, **verified email required** before any private data can be read or written
  (enforced by the app *and* by the rules via the `email_verified` token claim).
- Verification email with resend (60 s client cooldown), "I've verified" re-check, password reset (no account-enumeration signal), sign-out.
- Sessions persist (Firebase Auth local persistence) and are restored on reload. Firestore uses an **in-memory cache only** — no private
  record is stored in the browser between sessions, so a shared device cannot leak a previous account's cache.
- Private data under `users/{uid}/…`: `settings/sender`, `clients/{id}`, `invoices/{id}`, `counters/invoices`, and a `users/{uid}` profile.
- Invoice numbers keep the existing format **`RESH-<invoice year>-<sequence, min 3 digits>`** (e.g. `RESH-2026-001`).
  **Design change to approve:** the number is now assigned when an invoice is **issued** (inside a Firestore transaction on the
  per-account counter), not when a draft is created. Drafts show "Assigned when issued". This keeps issued numbers gap-free and safe across tabs/devices.
- Every write is a Firestore **transaction**, so a success message means the server committed it; offline writes fail instead of queueing.
  Updates carry the `updatedAt` the user saw, and a mismatch is reported as a conflict.
- Issued/paid/void invoices are immutable (rules + app). Allowed transitions: draft→issued, issued→paid, issued→void.

## Local development
```sh
npm ci
npm test            # syntax checks, unit/app tests, Firestore + Auth emulator suites (rules and data layer)
npm run test:e2e    # real Chrome against the emulators (needs Google Chrome and firebase-tools)
```
Run the app against the emulators: start `firebase emulators:start --only auth,firestore --project demo-invoice-studio-v2`
(ports in `firebase.json`), serve this folder on `localhost`, and open `/?emulator=1`. Emulator mode only works on `localhost`/`127.0.0.1`
and always uses the fictional `demo-invoice-studio-v2` project. Use only fictional accounts.

## Browser-local data migration (preview only)
Existing `localStorage` data is **never** attached to an account automatically. Settings → "Import browser data…" validates it, shows
counts/duplicates/numbering gaps, offers a checksummed backup download and a rollback plan, and performs **no writes**.
The confirmed import is intentionally disabled: historical issued/paid invoices cannot be created through the strict client rules
(they would need a separately approved import path in the rules). Decide that before enabling import.

## Release checklist (not yet approved)
1. Approve the numbering-at-issue design and the rules in `firestore.rules`.
2. Deploy rules to production Firestore, then immediately re-run the emulator suites against the exact deployed file and smoke-test with a throwaway verified account.
3. Consider enabling a Firebase Authentication password policy (min length 12), email-enumeration protection, and App Check — none are enabled today; client-side checks alone can be bypassed.
4. Restrict the web API key to the production domain (HTTP referrers) in Google Cloud Console.
5. Real-device (iPhone/Safari) testing, PDF visual review and a privacy policy / account-deletion path before public sign-ups.
6. Approve and build the historical-import path, then run the migration with backup/rollback.
7. Deploy through the normal pipeline only after the above. The CSP/security headers in `vercel.json` are untested on Vercel itself.
