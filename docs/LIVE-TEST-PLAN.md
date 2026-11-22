# Invoice Studio V2 — controlled live Firebase test plan (NOT EXECUTED)

Nothing in this plan has been run. It needs explicit approval for each live step. Facts below marked **(read-only check, 2026-11-22)** were read from the live project without changing it.

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
| 10 | Turn network off before saving, reconnect without changing records, then save | Offline refusal; reconnect clears the banner and permits a confirmed save. If connection is lost during a commit, treat the outcome as uncertain and inspect the list before retrying |
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

## 7. Settings to change before any public registration (read-only check, 2026-11-22: current value)
| Setting | Current | Recommended |
|---|---|---|
| Authorized domains | localhost, partypulse-d8ad3.firebaseapp.com, partypulse-d8ad3.web.app, reshwin-invoicestudio.vercel.app | keep; remove `localhost` before public launch if not needed |
| Password policy | no custom policy returned by the config API | min length 8 (matches the app's client-side check, which can be bypassed; enforce it in the TEST project first) |
| Email enumeration protection | **enabled** | keep |
| App Check (Firestore, Identity Toolkit) | UNENFORCED | separately approve client attestation and monitor Firestore traffic before enforcement; Authentication App Check requires an Identity Platform upgrade, which needs its own impact/cost review |
| Web API key restrictions | shared Browser key; API targets only; **no HTTP-referrer restriction** | prefer a separately approved dedicated restricted web key; do not restrict the shared PartyPulse key until its dependencies are known. Allow exact production/test origins and required Firebase APIs only |
| Email templates | default Firebase sender, default wording | review wording/branding; keep default sender or configure a verified domain |
| Billing | off (Spark) | decide on quotas/budget alerts; the rules cannot cap document counts per user |
| MFA | disabled | optional |
Also needed before launch: privacy policy, account deletion/export path, real iPhone/Safari testing and a decision on the deferred historical import.


## 8. Approval-ready execution boundary

Recommended next approval: create **one isolated test Firebase project** and one test web app (no Hosting), enable verified Email/Password only, enforce an 8-character minimum in that project, preserve enumeration protection, create a default Firestore database and deploy the reviewed `firestore.rules` to that project only. Record its exact ID, region, app ID, public config, rule hash, domains and quota/billing state before any test. Spark/no billing upgrade is the initial choice; stop if an upgrade is required. Project creation, settings, rules and accounts are not authorized by this preparation task.

Create a separately reviewed test build pointing only to that isolated public config (current tracked config remains fixed to production). Use an exact HTTPS preview URL; never a production alias. Confirm the built SDK project ID before entering credentials. Never substitute a production service account or copy production data. Do not enable App Check enforcement before that test build has attestation support and monitoring proves it works. Authentication App Check would additionally require an explicitly approved Identity Platform upgrade.

Approve **two disposable accounts**, A and B, using inboxes controlled by Reshwin and unique test passwords entered directly into the browser. Verification/reset codes and SDK tokens remain in browser memory/normal Firebase storage; do not paste or log them. The emulator’s fictional `example.test` addresses are not real inboxes and cannot validate live email delivery.

In addition to section 4, record these acceptance cases:

1. Confirm actual verification/reset delivery, expired/used link handling, an unknown reset address's identical message, and both old/new password behavior after a reset.
2. A creates exactly one sender, one client and three drafts. Reopen one editor on both devices: save on device 1, then save/delete stale content on device 2; it must report a conflict and preserve device 1's record. An externally deleted draft must not be silently recreated.
3. Issue two drafts concurrently; verify 001/002 once each, counter 2, immutable snapshots/totals, and no edit/delete of issued records. Mark one paid and the other void; terminal records cannot change.
4. With the official client SDK and B's session, test get/list/create/update/delete against A's known **fictional test paths**, unexpected fields, invalid money/status and an independent counter jump. All must be denied. Test signed-out and unverified requests separately. Never query legacy collections.
5. Disconnect before a save: no write is attempted. Reconnect with identical data: status recovers. Interrupt during a save: the message must report an unconfirmed outcome, then inspect the exact test record/counter before retrying. A request already committed at the server cannot be undone by a client timeout.
6. Switch A → B → A and sign out in a second tab while an operation is pending. No stale form, record, toast or success sheet may appear in the new session. Reload and browser Back must preserve isolation. Test real Safari/iPhone (including native share and print); Chrome viewport emulation is not Safari verification.
7. Export a fictional backup and PDF. The legacy browser key must remain byte-for-byte unchanged; import stays disabled. Exported backups are unencrypted files controlled by the user.

Stop on the first unexpected live result. Keep test evidence to counts, timestamps, paths/UID labels and failure codes, with no passwords, tokens, inbox contents or personal data. No data recovery claim is justified by rules rollback: rules change permissions, not stored data.

For isolated rollback: release deny-all in the **test** project, stop the test preview, disable only A/B if separately approved, and preserve evidence. Cleanup requires approval naming the exact test project and UIDs; deleting Auth accounts does not delete Firestore subcollections. Prefer deleting the isolated project only after ownership and disposal are explicitly confirmed. Production `partypulse-d8ad3`, old apps, `rooms/**`, IAM and billing stay untouched. Never restore the original publicly writable PartyPulse rules.

## 9. Verified production boundary and limitations (2026-11-22)

Read-only metadata confirmed `partypulse-d8ad3`, display name Reshwin Invoice Studio, both web registrations, Email/Password with password required, enumeration protection enabled, the four domains in section 7, billing disabled, and the default native database in asia-south1 with PITR/delete protection disabled. No user records or documents were inspected. The live release is still ruleset `8ac4ed17-8894-4903-9418-d6b9612c7b67`, source SHA-256 `7bff2de50c73415a3b12a6783f42ff621b1b04803ffc4e2634e6ba68e5d655f9`. The proposed per-user rules are different and have **not** been deployed. Live delivery, sync, indexing behavior and production access isolation are unverified.

Rules protect against other clients, not privileged Admin/IAM callers. They validate owner, fields, money, states and atomic counters but do not prove legal invoice accuracy, cap account/document counts or provide abuse/billing limits. Monitor quotas, budget/usage and sign-up abuse before a public release; billing alerts alone are not spending caps. The already-approved Auth service-agent IAM baseline is recorded in local evidence; no IAM change was made here. Account deletion, retention/privacy terms, Unicode PDF font coverage and recovery/backup strategy remain launch decisions.

Reference guidance: [Firestore metadata events](https://firebase.google.com/docs/firestore/manage-data/enable-offline), [password policy and enumeration protection](https://firebase.google.com/docs/auth/web/password-auth), [App Check/Auth upgrade requirement](https://firebase.google.com/docs/auth/faq-and-troubleshooting), [Firebase API key restrictions](https://firebase.google.com/docs/projects/api-keys). Public API keys identify a project and are not authorization credentials; Security Rules remain essential.
