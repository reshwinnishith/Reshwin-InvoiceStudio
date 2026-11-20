# Reshwin Invoice Studio

A lightweight, mobile-first invoice generator for personal use. No login, framework, server, build step or cloud storage.

## Use

Open `index.html` or deploy the repository as a static site. Fill in **Your Details** before creating an invoice. Add clients with the central **+** button in Clients. Tap a client to view the record, then **Edit Client** to change it.

Create invoices with the **+** button on Home. The invoice preview includes your details, the client's saved details, amount, optional GST, and bank information. **Download PDF** opens the browser print dialog; select **Save as PDF**, A4, and margins None. This is **not** a direct PDF-file generator.

## Data and privacy

Data is stored **only in your current browser** using localStorage. Invoices, clients and settings survive refreshes in that browser; they do **not** sync between browsers or devices. Clearing browser storage or using private browsing can erase them. Export a backup in Settings regularly, store it securely, and restore it from the same screen when needed.

Backups contain personal, customer and bank information. Do not share them publicly. Never hardcode personal details or financial identifiers in the public repository. **Important:** sensitive example details in the original public commit are still visible in Git history until that history is remediated separately.

Invoice records save a snapshot of the sender and client details at creation. Editing a client or Your Details does not silently update past invoices. Editing an existing invoice intentionally creates an updated snapshot.

## Important limitations

- This is an invoice drafting tool, **not** accounting, legal or tax advice. Determine whether GST applies and the correct tax rate independently.
- Invoice numbering is unique **within the saved browser dataset**, not across multiple devices or restored competing backups.
- The PDF flow uses the browser print dialog. Long addresses and descriptions and iPhone printing still need live device testing.
- No authentication, cloud sync, server backup, invoice email sending or payments collection are included.

## Developer checks

```sh
node --check app.js
node tests/smoke.cjs
```

GitHub Actions runs these checks on the repair branch and on pull requests. They cover core calculations and data flows, not real-browser visual/print testing.
