# Invoice Studio V2 — deep engineering, user-journey and security review (23 Nov 2026)

Local only: loopback Firebase emulators, fictional accounts and data, local Chrome. No live Firebase, Vercel or GitHub changes; nothing committed or pushed. Branch `v2/auth-cloud-sync`, HEAD `a0c1926` (unchanged; all work is uncommitted).

## User journeys actually exercised (real Chrome, `npm run test:journey`, 136 checks)
New-user sign-up with invalid email / short / mismatched / empty password → account creation → verify screen → emulator verification → empty home → editor blocked until a client exists → Your Details (invalid PAN refused, IFSC normalised) → three clients (200-char name, multi-line 600+ char address, PAN+GSTIN) → blank name, 200-char cap and GSTIN/PAN mismatch refused → unsaved-form leave prompt (cancel keeps you there) → client edit → eight invalid amounts refused (empty, 0, negative, `1,000`, 3 decimals, text, over ₹10 crore, `1e5`) → blank description refused → GST entitlement confirmation → exact totals (₹12,345.67 + 18% = ₹2,222.22, total ₹14,567.89, words) → reload: session restored, draft persisted → edit draft; 99 paise @5% rounds to 5 paise (₹1.04) → five rapid taps create one draft → leave editor while save is in flight → draft of a removed client → stale-details warning before issuing → issue (RESH-2026-001 from a 31 Dec 2026 invoice date), paid (Void no longer offered), second issue 002, void → PDF downloaded and parsed: number and amounts match the screen → two tabs: stale save = conflict, newer value survives; delete acts on refreshed record → two tabs issue simultaneously: 003/004, distinct → offline save refused, reconnect, same save succeeds once → logout clears DOM; browser Back shows nothing private → account B: empty workspace, details and clients → password reset: identical message for unknown/real address, old password fails, new works, same workspace; reload restores session → layout/accessibility sweep of 8 screens × 5 widths (320/375/390/768/1280) → keyboard Tab order and focus rings.

## Bugs found and fixed
| # | Defect (reproduced first) | Fix | Regression test |
|---|---|---|---|
| 1 | **Editing a draft whose client was removed silently selected another client** (observed: "Alpha…"); saving would re-bill the wrong client. Duplicate uses the same code path, so it is fixed too (not separately tested). | `fillClients` adds "Choose a client (the original was removed)" with an empty value, so saving requires a deliberate choice. | journey: "removed client" ×2 (failed before fix) |
| 2 | **A save that finished after you left the screen pulled you back** (editor → Home, then yanked into the invoice view; Details/Client/Delete similar). | Navigate after a save only if still on the originating screen; otherwise just confirm with a toast and refresh. | journey: "save in flight" (failed before fix) |
| 3 | **Issuing froze outdated sender/client details without warning** (draft snapshots are taken at save; issuing does not refresh them; rules forbid changing them while issuing). | Issue confirmation now names what changed and tells the user to Edit → Save first. No rules change. | journey: warning shown/cancel issues nothing; no warning once updated |
| 4 | **PDF party columns were laid out in lockstep**, so a long name in one column created blank gaps inside the other column's address (visible in rendered pages). | Each column flows independently; page breaks still shared. | parity: "address lines evenly spaced" (failed before: 27.0/29.8 px gaps) |
| 5 | **PDF continuation pages: description text touched the repeated table header** (2.8 px). | 12 px top padding on continued lines. | parity: "space below the table header" (failed before on 6 pages) |
| 6 | "Delete draft"/"Delete client" touch target 37 px and no keyboard focus ring. | `min-height:44px` and gold `:focus-visible` ring (existing style). | journey keyboard checks |

## New / extended tests
- `tests/e2e/journey.e2e.mjs` (new, 136 checks) + `npm run test:journey` + CI step.
- `tests/rules/forgery.test.mjs` (new, 6 tests): create-as-issued/paid/void with valid-looking numbers, client-chosen timestamps, type confusion (strings/fractions/non-maps), unsafe/oversized ids, revert issued→draft/renumber/re-date/delete, paid→void/issued, deletion of profile/sender/counter. All denied, with positive controls.
- `tests/rules/scoped-policy.test.mjs` (earlier session, 7 tests) — two-UID allowlist, expiry, deny-all rollback.
- PDF parity fixtures: `maxFields` (200/2000/4000-char limits, 4 pages), `nearPageBreak`, `zeroTaxSmall` (₹0.01); two new layout checks.

## Final results (run twice where noted)
| Suite | Result |
|---|---|
| Syntax check (`npm run check`) | pass |
| Unit/app suites (core, invoice view, app flows) | 3/3 pass |
| Emulator: rules + scoped policy + forgery + cloud/auth | **64/64** pass (×2) |
| Chrome e2e (`test:e2e`) | **53/53** |
| PDF parity (`test:parity`) | **98/98** (14 fixtures) |
| User journey (`test:journey`) | **136/136** (×2) |
| `npm audit` | 0 vulnerabilities |
PDF generation: 2.5–5.6 ms per invoice in Chrome after the library loads (7-page invoice 5.6 ms).

## Evidence (git-ignored, fictional data only)
- Journey screenshots incl. 24 layout shots: `.runtime/journey/` (+ downloaded `journey-RESH-2026-001.pdf`)
- Rendered PDF pages (25 PNGs, rendered locally with the project's pdf.js in Chrome): `.runtime/pdf-png/`; PDFs: `.runtime/pdf/`
- Final run logs: `.runtime/final/`

## Security findings
- Rules held against every new attack case; no rules change was needed. Account isolation verified in the UI and independently in the emulator.
- **CSP observation:** while offline, the Firestore SDK tries to load `https://www.google.com/images/cleardot.gif` (connectivity probe); `img-src` blocks it and logs a console error. Harmless; intentionally **not** allowed. The journey test filters only that message.
- Migration preview remains read-only; legacy browser data untouched (existing smoke tests).
- No secrets, personal identifiers, project IDs or email addresses in changed/new files (scanned).

## Not tested / limitations
- Real iPhone Safari, native share/print on iOS, real email delivery, live Firebase — not run.
- No real screen reader (VoiceOver) run; checks cover accessible names, labels, focus order and focus rings only. High zoom approximated by 320 px widths.
- The app supports **one line per invoice, INR only, no quantities/discounts** by design; line-item multiplication and multi-currency steps of the brief are not applicable. Adding them is a feature/rules change, not a fix.
- In-app navigation does not use browser history, so browser Back leaves the app instead of going to the previous screen (unchanged; design decision).
- The invoice counter continues across years (number year comes from invoice date) — existing documented behaviour.

## Suggested commit (not made)
`fix(v2): keep users on their screen after late saves, never re-point drafts of removed clients, warn on stale snapshots, independent PDF party columns; add journey, forgery and scoped-policy tests`
Files: `app.js`, `pdf.js`, `ui.css`, `README.md`, `package.json`, `.github/workflows/checks.yml`, `scripts/run-emulator-tests.mjs`, `scripts/local-env.sh`, `scripts/materialize-scoped-rules.mjs`, `tests/e2e/journey.e2e.mjs`, `tests/e2e/parity-fixtures.mjs`, `tests/e2e/pdf-parity.e2e.mjs`, `tests/rules/forgery.test.mjs`, `tests/rules/scoped-policy.test.mjs`, and optionally this report. Never `firebase-preparation/` or `.runtime/`.

## Before the real Firebase test
Unchanged from the runbook: (1) Reshwin accepts the documented privileged-IAM/audit-coverage limits; (2) Approval 1 — two owner-controlled inboxes, create exactly two ordinary accounts (≤ 8 emails) under deny-all; (3) settle how each new UID is captured (the app does not display it) and dry-run it in the emulator; (4) Approval 2 — exact UIDs, ≤ 2-hour UTC window, generated Stage A/B hashes, caps, rollback and cleanup choice. Also: deploy this branch's code to the existing preview first (needs commit/push approval) so the live test exercises these fixes.
