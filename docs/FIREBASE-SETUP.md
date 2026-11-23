# Invoice Studio V2 — Firebase accounts, sync and security

The account/cloud code is present in the repository; PR #3 has already merged. **Production Firestore remains deny-all.** Read-only verification on 2026-11-22 confirmed `partypulse-d8ad3` default database still uses ruleset `8ac4ed17-8894-4903-9418-d6b9612c7b67`. The per-user `firestore.rules` file is tested locally and **not deployed**. Code availability does not mean live sync has been enabled or tested.

## Account and data behavior

- Email/password login, verification gate, resend, password reset and logout are implemented. The proposed rules require a verified email and the password provider.
- Firebase Auth persists the login across reloads until sign-out. Firestore records use memory cache only. Logout/account changes clear private UI and reload the page to discard SDK memory; the next verified session loads its own records from the server.
- Private paths are `users/{uid}`, `settings/sender`, `clients/{id}`, `invoices/{id}` and `counters/invoices` below that UID.
- Approved numbering is `RESH-<invoice date year>-<sequence padded to at least 3 digits>`. Numbers are assigned only at issue time. Each account has one sequence continuing across years. Drafts consume no number.
- Writes use transactions with no offline write queue. Save success means server confirmation. If a connection fails during a commit, the result can be uncertain: check the list/counter before retrying. A client timeout cannot undo a request already committed at the server.
- Editors retain the version originally displayed; a newer record causes a conflict. Conflict tokens preserve Firestore timestamp precision. Stale deletes are also rejected.
- Issuing atomically updates the invoice and counter. Issued content is immutable; issued → paid or void is permitted, with terminal states then frozen. These constraints apply to client requests; privileged Admin/IAM callers bypass Security Rules.

## Local checks

Use Node 22+, Java 21+, Firebase CLI 15.20.0 and Chrome. Download the Firestore emulator with `firebase setup:emulators:firestore`. See the README for portable path overrides.

```sh
npm ci
npm test             # syntax, core/view/app suites, local Auth/Firestore rules and integration tests
npm run test:e2e     # Chrome; isolated demo Auth/Firestore emulators, no production credentials
npm run test:parity  # fictional PDF fixtures; Firebase initialization removed from its test page
```

For manual emulator work, run `firebase emulators:start --only auth,firestore --project demo-invoice-studio-v2`, serve this folder on localhost and open `/?emulator=1`. Only localhost/127.0.0.1 can enter emulator mode; use fictional accounts. Never point automated tests at the live project.

## Browser records and PDF limitations

The earlier `reshwin-invoice-studio-v2` browser key remains untouched. It is never uploaded automatically. Import preview validates and offers a backup without cloud writes. Malformed data is reported, and sparse/high historical numbering has bounded preview work. Historical import stays disabled and is deferred; it is not a release prerequisite.

Backups are unencrypted downloads and must be stored securely. The PDF library is pinned with SRI. Its built-in fonts cover limited scripts: unsupported Unicode is refused with a Print / Save as PDF fallback rather than silently substituted. Real iPhone Safari, native sharing/printing and live email delivery remain separate acceptance tests.

## Release sequence needing separate approval

1. Review the code-only follow-up draft PR and CI/preview results. Do not merge or promote automatically.
2. Approve the isolated Firebase test project and two disposable inbox-backed accounts described in [LIVE-TEST-PLAN.md](LIVE-TEST-PLAN.md), plus exact test settings and rules deployment. Production stays deny-all throughout that test.
3. Run the documented live acceptance cases and real Safari/iPhone checks. Review password policy, quotas, abuse controls, privacy/retention, recovery and account deletion. Enumeration protection is already enabled in production; a custom password policy was not returned by the current config API. App Check is unenforced. Auth App Check requires a separately reviewed Identity Platform upgrade.
4. Prefer a dedicated restricted web API key after testing, preserving the shared PartyPulse key's dependencies. Referrer restrictions do not replace rules or stop all API abuse.
5. Only after passing those gates, request a separate approval naming the production rules hash/project/database, application commit and rollout/deny-all rollback. A production deploy, settings change or live account/data write is not authorized by this handoff.
