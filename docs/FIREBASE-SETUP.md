# Firebase multi-user migration — setup plan (not active)

Invoice Studio currently uses browser-only localStorage. This document and `firestore.rules` prepare a safe future migration, **but no Firebase configuration or live account integration is installed yet**.

## Goal
Each person signs in through Firebase Authentication and sees only their own clients, sender details and invoices. Data must never be shared across users or silently migrated from another browser session.

## Before enabling
1. Create a **dedicated Firebase project** for Invoice Studio, not an existing unrelated product. Record the public web-app configuration (projectId, authDomain, appId, apiKey). The browser API key is public configuration; **do not put admin SDK service account keys in the app or GitHub**.
2. Enable only the intended sign-in providers (email/password or Google) in Firebase Authentication and configure authorized domains.
3. Create Firestore in an appropriate region and deploy the reviewed `firestore.rules` **before** connecting any production user data.
4. Use Firestore Emulator tests to verify user A cannot read or write user B's invoices, details, clients or counters; anonymous requests must be denied. Validate owner-only access on every path.
5. Decide data migration: user explicitly signs in and chooses to import a local backup into **their** account; do not automatically attach old browser data to an arbitrary logged-in user.
6. Use Firestore transactions for invoice sequencing if numbering must remain unique across tabs/devices. Every invoice record must store a frozen client and sender snapshot.
7. Test offline and failed writes. Do not claim that an invoice is saved or issued unless the server has confirmed the write.
8. Add account deletion, data export, and a clear privacy policy before opening registration to the public. Avoid collecting unnecessary identity fields.
9. Rate-limit and guard sign-up as appropriate for public launch. Monitor Firebase costs and usage.

## Suggested Firestore paths
- `users/{uid}` — profile and preferences
- `users/{uid}/clients/{clientId}` — clients
- `users/{uid}/invoices/{invoiceId}` — owned invoices
- `users/{uid}/settings/private` — sender details
- `users/{uid}/counters/invoices` — transaction-managed counter

Owner-only rules in `firestore.rules` are intentionally strict. They do not establish a business/tax compliance guarantee and have **not** been deployed.
