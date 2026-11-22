# Reshwin Invoice Studio

A lightweight, mobile-first invoice generator. V2 (in development) adds Firebase email/password accounts, verified email, private per-user cloud storage and transaction-safe invoice numbering — see [docs/FIREBASE-SETUP.md](docs/FIREBASE-SETUP.md). No build step.

## Use

Serve this folder over HTTP on localhost or deploy it as a static site. ES modules require a web server. Fill in **Your Details** before creating an invoice. Add clients with the central **+** button in Clients. Tap a client to view the record, then **Edit Client** to change it.

Create invoices with the **+** button on Home. The invoice preview includes your details, the client's saved details, amount, optional GST, and bank information. **Download PDF** creates an A4 PDF inside the browser using a pinned jsPDF library loaded on demand. If the library cannot load (for example offline), use **Print / Save as PDF** and select A4, margins None.

## Data and privacy

V2 stores each person's sender details, clients and invoices privately in Firestore under `users/{uid}`, available only to the signed-in, email-verified owner. Invoice records use an in-memory Firestore cache, cleared by reloading on logout/account changes. Firebase keeps the sign-in session across reloads until you sign out; legacy local records and exported backups remain separate. Invoice records keep a frozen snapshot of the sender and client at creation, and issued invoices cannot be edited. Backups you export contain personal and bank details: keep them secure. **Never put personal or financial identifiers in the public repository or in test data.**

Data saved by earlier browser-only versions stays in that browser's localStorage, untouched. It is not uploaded automatically; see the migration notes in docs/FIREBASE-SETUP.md.

## Important limitations

- This is an invoice drafting tool, **not** accounting, legal or tax advice. Determine whether GST applies and the correct tax rate independently.
- Invoice numbers (RESH-YYYY-NNN) are allocated per account in a server transaction when an invoice is issued.
- Direct PDF generation requires the online jsPDF library the first time you use it. The fallback uses the print dialog. Long text is covered by PDF fixtures; unsupported scripts use the Print / Save as PDF fallback instead of substituting incorrect characters. Real iPhone printing and sharing still need device testing.
- Authentication and cloud-sync code are included, but production Firestore remains **deny-all** until a separately approved rules release. The proposed owner-only rules have been tested locally. Invoice email sending, payments and automated backups are not included. See [the controlled live-test plan](docs/LIVE-TEST-PLAN.md).

## Developer checks

```sh
npm ci && npm test        # checks, unit/app tests, Auth+Firestore emulator suites
npm run test:e2e          # real Chrome against isolated emulators
npm run test:parity       # fictional PDF fixtures, no Firebase initialization
```

GitHub Actions runs syntax, unit/app, Auth/Firestore emulator, Chrome end-to-end and PDF parity checks on main, the V2 branch and pull requests. Local emulator tests use a demo project and no production credentials. Real iPhone Safari and live email delivery still need separately approved testing.

Use Node 22+, Java 21+, Firebase CLI 15.20.0 and a downloaded Firestore emulator (`firebase setup:emulators:firestore`). On other machines set `INVOICE_JAVA`, `INVOICE_FIREBASE_LIB` (CLI lib directory) and `CHROME_PATH`; optionally `INVOICE_FIRESTORE_JAR`. CI sets the platform paths explicitly.
