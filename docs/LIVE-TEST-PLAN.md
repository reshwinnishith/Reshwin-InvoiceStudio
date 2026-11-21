# Invoice Studio V2 — controlled live Firebase test plan (NOT EXECUTED)

Nothing in this plan has been run. It needs explicit approval for each live step. Facts below marked **(read-only check, 2026-11-21)** were read from the live project without changing it.

## 1. Recommended approach: isolated test project first
| | **A. New isolated Firebase project (recommended)** | **B. Deploy V2 rules to `partypulse-d8ad3`** |
|---|---|---|
| Production deny-all | untouched | replaced by V2 rules (rollback below) |
| Legacy PartyPulse data/app | not involved | same project; stays denied by V2's catch-all deny, but any rules mistake is in the real project |
| Disposable | yes — delete the whole project afterwards | no |
| Cost to set up | create project + web app, enable Email/Password, password policy, deploy rules; **small reviewed code change** so a test build can use a different public config (today `firebase-config.js` is fixed to `partypulse-d8ad3`) | none beyond the rules deploy |
| Main risk | extra setup; test config must never ship to production | production change before the rules are proven live |

Recommendation: do **A** first (nothing production is touched), then repeat the identical checklist on `partypulse-d8ad3` after you approve its rules deploy. If you prefer B directly, use section 6 as the gate.

## 2. Exactly what the V2 rules (`firestore.rules`) allow
Everything is denied except `users/{uid}/…` for a request whose token has `email_verified == true` and sign-in provider `password`, where `uid` equals the caller's own UID:
- `users/{uid}`: read, create (once), update `displayName`; never delete.
- `settings/sender`: read, create/update with validated fields (name, address, PAN/IFSC/account formats); never delete.
- `clients/{id}`: read, create/update/delete with validated fields.
- `invoices/{id}`: read; create only as a **draft** with validated money (integer paise, max ₹10 crore, GST 0/5/12/18/28 with exact half-up tax, total = amount + tax) and a real calendar date; edit drafts; delete drafts only. Issuing is allowed only together with the matching counter increment in the same transaction and with number `RESH-<date year>-<sequence padded to 3>`. Issued → paid or void only. All other fields of issued invoices are frozen.
- `counters/invoices`: write only as +1 together with issuing a draft; never delete or reset.
- Anonymous, unverified, other-provider, other-user and every other path: denied. Admin/Console access is not governed by rules.

## 3. Pre-conditions (all outside this repo; need approval)
1. Disposable account email you control (e.g. a plus-address or throwaway inbox) — **not** your personal primary address.
2. Fictional data only (e.g. "Fictional Client Ltd"). No real PAN, GSTIN, account or IFSC values.
3. Rules deploy (target project only) and, for option A, project creation. Record the ruleset ID before and after.
4. For a Vercel preview test: **no extra authorized domain should be needed** — email/password sign-in does not use the authorized-domain list; the app omits the email "continue URL" on every host except `reshwin-invoicestudio.vercel.app`. Confirm this during step 5 below. Do **not** add wildcard or `*.vercel.app` domains. If a preview-hostname entry proves necessary, add only that exact hostname, and remove it afterwards.

## 4. Test script (disposable account, about 20 minutes)
| # | Action | Expected |
|---|---|---|
| 1 | Open the site signed out | Welcome screen only; no private UI; console clean |
| 2 | Create account with a 8+ character password | "Verify your email" screen; no workspace; direct Firestore reads in DevTools are denied |
| 3 | Tap "I've verified" before clicking the email link | Stays on verify screen |
| 4 | Click the emailed link, return, tap "I've verified" | Home screen, empty |
| 5 | Resend / reset password from a signed-out tab | Success message; reset email arrives; wrong-address request shows the same message |
| 6 | Save Your Details, add one client, create a draft | "Saved" only after server round trip; data visible after reload and in a second browser |
| 7 | Issue the draft | Number `RESH-<year>-001`; Edit/Delete disappear; second device shows it |
| 8 | Create 2 drafts; issue one on each of two devices at the same moment | Numbers 002 and 003, no duplicates |
| 9 | Mark paid; try Void on a paid invoice | Paid works; Void is not offered/denied |
| 10 | Turn network off, try to save | Clear offline message, nothing saved, no later phantom |
| 11 | Sign out; press Back; open a second disposable account | No data from account 1 anywhere; page reloads on logout |
| 12 | Download PDF | Valid A4 PDF with number and fictional data |
| 13 | In DevTools Console try `getDoc` on another UID's path / a top-level collection | `permission-denied` |
Record pass/fail, console errors and network failures for each step.

## 5. Rollback
- **Rules:** re-release the previously recorded ruleset (production deny-all is `8ac4ed17-8894-4903-9418-d6b9612c7b67`) from Console → Firestore → Rules → history, or the Rules REST API release update. Takes effect in about a minute.
- **App:** a preview needs no rollback; production deploys would use Vercel's instant rollback.
- **Auth:** disable the test user in Console if anything misbehaves.

## 6. Clean-up boundaries
Delete only the disposable user (Console → Authentication) and its `users/{uid}` document tree (Console, one document at a time). Do not run bulk deletes, never touch `rooms/**`, and never delete other users. For option A, deleting the test project removes everything.

## 7. Settings to change before any public registration (read-only check, 2026-11-21: current value)
| Setting | Current | Recommended |
|---|---|---|
| Authorized domains | localhost, partypulse-d8ad3.firebaseapp.com, partypulse-d8ad3.web.app, reshwin-invoicestudio.vercel.app | keep; remove `localhost` before public launch if not needed |
| Password policy | not set | min length 8 (matches the app's client-side check, which can be bypassed; enforce it in the TEST project first) |
| Email enumeration protection | **enabled** | keep |
| App Check (Firestore, Identity Toolkit) | UNENFORCED | register reCAPTCHA provider, run in monitor mode first, then enforce |
| Web API key restrictions | API targets only; **no HTTP-referrer restriction** | restrict to `reshwin-invoicestudio.vercel.app/*` (add preview/localhost only while testing) |
| Email templates | default Firebase sender, default wording | review wording/branding; keep default sender or configure a verified domain |
| Billing | off (Spark) | decide on quotas/budget alerts; the rules cannot cap document counts per user |
| MFA | disabled | optional |
Also needed before launch: privacy policy, account deletion/export path, real iPhone/Safari testing and a decision on the deferred historical import.
