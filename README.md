# Reshwin Invoice Studio

A lightweight, mobile-first invoice generator. V2 (in development) adds Firebase email/password accounts, verified email, private per-user cloud storage and transaction-safe invoice numbering — see [docs/FIREBASE-SETUP.md](docs/FIREBASE-SETUP.md). No build step.

## Use

Open `index.html` or deploy the repository as a static site. Fill in **Your Details** before creating an invoice. Add clients with the central **+** button in Clients. Tap a client to view the record, then **Edit Client** to change it.

Create invoices with the **+** button on Home. The invoice preview includes your details, the client's saved details, amount, optional GST, and bank information. **Download PDF** creates an A4 PDF inside the browser using a pinned jsPDF library loaded on demand. If the library cannot load (for example offline), use **Print / Save as PDF** and select A4, margins None.

## Data and privacy

V2 stores each person's sender details, clients and invoices privately in Firestore under `users/{uid}`, available only to the signed-in, email-verified owner. Nothing is cached in the browser between sessions. Invoice records keep a frozen snapshot of the sender and client at creation, and issued invoices cannot be edited. Backups you export contain personal and bank details: keep them secure. **Never put personal or financial identifiers in the public repository or in test data.**

Data saved by earlier browser-only versions stays in that browser's localStorage, untouched. It is not uploaded automatically; see the migration notes in docs/FIREBASE-SETUP.md.

## Important limitations

- This is an invoice drafting tool, **not** accounting, legal or tax advice. Determine whether GST applies and the correct tax rate independently.
- Invoice numbers (RESH-YYYY-NNN) are allocated per account in a server transaction when an invoice is issued.
- Direct PDF generation requires the online jsPDF library the first time you use it. The fallback uses the print dialog. Long text, custom characters, and iPhone printing still need live device testing.
- No authentication, cloud sync, server backup, invoice email sending or payments collection are included. Firebase planning and example owner-only rules are in [docs/FIREBASE-SETUP.md](docs/FIREBASE-SETUP.md); they are **not deployed or connected**.

## Developer checks

```sh
npm ci && npm test        # checks, unit/app tests, Auth+Firestore emulator suites
npm run test:e2e          # real browser against the emulators
```

GitHub Actions runs these checks on the repair branch and on pull requests. They cover core calculations and data flows, not real-browser visual/print testing.
