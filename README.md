# Reshwin Invoice Studio

A lightweight, mobile-first invoice generator for personal use. No login, framework, server, build step or cloud storage.

## Use

Open `index.html` or deploy the repository as a static site. Fill in **Your Details** before creating an invoice. Add clients with the central **+** button in Clients. Tap a client to view the record, then **Edit Client** to change it.

Create invoices with the **+** button on Home. The invoice preview includes your details, the client's saved details, amount, optional GST, and bank information. **Download PDF** creates an A4 PDF inside the browser using a pinned jsPDF library loaded on demand. If the library cannot load (for example offline), use **Print / Save as PDF** and select A4, margins None.

## Data and privacy

Data is stored **only in your current browser** using localStorage. Invoices, clients and settings survive refreshes in that browser; they do **not** sync between browsers or devices. Clearing browser storage or using private browsing can erase them. Export a backup in Settings regularly, store it securely, and restore it from the same screen when needed.

Backups contain personal, customer and bank information. Do not share them publicly. Never hardcode personal details or financial identifiers in the public repository. **Important:** sensitive example details in the original public commit are still visible in Git history until that history is remediated separately.

Invoice records save a snapshot of the sender and client details at creation. Editing a client or Your Details does not silently update past invoices. New invoices start as **Draft**. Drafts can be edited. Once **Issued**, the invoice is locked; it can then be marked Paid or Void, or duplicated as a fresh draft. Legacy invoices without an explicit status are treated as Issued for safety.

## Important limitations

- This is an invoice drafting tool, **not** accounting, legal or tax advice. Determine whether GST applies and the correct tax rate independently.
- Invoice numbering is unique **within the saved browser dataset**, not across multiple devices or restored competing backups.
- Direct PDF generation requires the online jsPDF library the first time you use it. The fallback uses the print dialog. Long text, custom characters, and iPhone printing still need live device testing.
- No authentication, cloud sync, server backup, invoice email sending or payments collection are included. Firebase planning and example owner-only rules are in [docs/FIREBASE-SETUP.md](docs/FIREBASE-SETUP.md); they are **not deployed or connected**.

## Developer checks

```sh
node --check app.js
node --check pdf.js
node tests/smoke.cjs
```

GitHub Actions runs these checks on the repair branch and on pull requests. They cover core calculations and data flows, not real-browser visual/print testing.
