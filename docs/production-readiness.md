# Production handoff

The live database was upgraded and the administrator was provisioned and verified on 2026-10-05. No email delivery, payment transfer, or deployment was performed during this work.

## Live setup status and remaining release checks

- The Supabase API and database are now reachable. Migrations `202610040000` through `202610040008` committed after a verified private backup, regression tests and a rollback-only rehearsal against the live database.
- `DATABASE_URL` is configured in the ignored `.env` from the existing PostgreSQL connection previously stored under `SUPABASE_URL`. `DATABASE_SSL_CA_FILE` supplies Supabase's verified public root certificate; certificate and hostname verification stay enabled.
- `admin:sync` updated the existing administrator's credentials from `.env`. A real password sign-in, authenticated `/api/me`, `/api/admin/snapshot`, `/api/health/ready` and `check:backend` all passed. The administrator's existing Auth identity was preserved.
- Verify email delivery/recovery, Cloudflare email routing, scheduler execution, complete worker workflows, restore procedures and deployment monitoring before production rollout.

The private backup is in the ignored, owner-only `.backups` directory. Migration `000` converts the recognized legacy enum, array and worker-identity schema while preserving records. Original invalid worker-account links remain in the private `legacy_worker_accounts` table; only verified owner/account links become active canonical associations. Historical KYC audit events whose parent or actor was already removed remain unchanged under narrowly scoped `NOT VALID` foreign keys; those keys enforce every future write. Core ownership constraints remain validated. Unrelated quoted CamelCase tables were left intact.

Independent random `WORK_EMAIL_CRYPTO_SECRET` and `CRON_SECRET` values were added to the ignored local `.env.local`. Store them in the production secret manager before using them there. Preserve the encryption key and its backup: replacing it makes existing ciphertext unreadable. No keys belong in version control or client-prefixed environment variables.

## Verification provided

Local verification includes TypeScript, backend lint, 46 backend regression tests, the production Webpack build and HTTP smoke checks. The production dependency audit reported zero known vulnerabilities. On 2026-10-05, the hosted administrator password sign-in and protected APIs passed on a local production instance; live readiness reported ready. Worker onboarding, email delivery and payout workflows still require full staging verification.

`npm run check` generates Next.js route types, checks TypeScript, runs API authorization tests and PostgreSQL migration/transaction tests, and lints backend code. Database tests run real PostgreSQL semantics through PGlite with small Auth/Storage schema stubs. They cover:

- Every private route rejects unauthenticated requests before accessing data; worker isolation, inactive accounts, verified sessions, administrator spoofing, malformed/oversized bodies and safe outage responses.
- Work status transitions, five-account credential submissions, quota enforcement, encryption failures and upload signatures.
- Payout reservation, retries, minimum earnings, KYC/UPI checks, processing state, payment references and immutable paid items.
- Exactly-once gig approval credits, scheduling retries and reassignment, protected work history, worker provisioning rollback, stale application/KYC decisions and unique inbox ownership.
- Database roles cannot read private tables or execute privileged transactions; private storage is inaccessible to direct browser writes.

PGlite serializes requests on a single database instance. These checks do not replace load testing against a hosted PostgreSQL deployment with multiple application instances. The backend lint target is distinct from `npm run lint`; existing frontend lint issues remain outside this backend change.

## Staging and release procedure

1. Use Node.js 22 and `npm ci`. Configure `.env.local` from `.env.example`, or inject the variables through your platform. Set the canonical HTTPS `NEXT_PUBLIC_APP_URL` before building. Keep demo flags disabled.
2. Back up the existing database and rehearse restore. Compare its schema with `supabase/migrations`. The baseline is canonical snake_case; older camelCase tables, duplicate worker codes, multiple active payout batches, duplicate earnings reservations, duplicate mailbox addresses, and incompatible constraints require explicit data reconciliation first. Do not delete conflicting data just to force a migration through.
3. Run `npm run db:migrate` against staging. For Supabase's private CA, configure `DATABASE_SSL_CA_FILE` or inject the PEM through `DATABASE_SSL_CA`. The runner uses verified TLS, an advisory lock, checksums and one transaction for all pending migrations, including security grants. Any pending migration failure rolls the entire pending set back. Migration `000` handles the recognized legacy layout; incompatible identities, values or ownership conflicts fail safely for review. Migration `008` preserves existing Auth/profile hooks under the canonical identity and authorization rules. Do not modify a migration after applying it; create a new migration instead. Do not run the old individual schema SQL files as the deployment procedure.
4. Run `npm run credentials:check`. Legacy plaintext credentials are intentionally unreadable through the API. Back up the credential tables and encryption key, then run `npm run credentials:migrate` during a maintenance window. It validates all existing ciphertext before any write and uses compare-and-set updates. A failed or interrupted apply can leave some rows encrypted; rerun the check and apply with the same key until plaintext is zero. This command does not rotate an existing encryption key.
5. Run `npm run check:backend`. It checks configuration, Supabase DNS, schema version, required columns and bucket visibility without sending mail, mutating application data, or revealing secrets. DNS failure stops dependent probes so an unreachable hostname is not mistaken for a missing migration. Resolve every failed check.
6. Configure Supabase Auth site/redirect URLs, email confirmation, recovery delivery and sender credentials. Configure server-only `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_NAME`, run `npm run admin:check`, then `npm run admin:sync` to provision the administrator. The server environment and the database's enrolled Auth user must agree. See [administrator setup](admin-setup.md). Migration `202610040007_admin_identity.sql` removes the former hardcoded owner behavior and requires explicit enrollment before admin access resumes.
7. Configure the email worker's `GIG_INGEST_URL` and `GIG_INGEST_SECRET`; the latter must match the application's `GIG_INBOX_INGEST_SECRET`. Route the configured gig and work-email domains to this worker. Confirm a test message appears only in its owner's inbox; repeat delivery must not duplicate it. The old embedded fallback secret has been removed; do not use it as a deployment secret.
8. Set an external scheduler to POST `/api/jobs/schedule` every 15 minutes with `Authorization: Bearer <CRON_SECRET>`. Store the token in the scheduler's secret store. The job creates the next two scheduled slots per assignment and can be retried safely. No worker page read creates work items. Also POST `/api/jobs/application-automation` every 15 minutes with the same token; it runs enabled application automation rules for new matches only and is safe to retry or overlap.
9. Run `npm run check`, `npm audit --omit=dev --audit-level=high`, `npm run build`, and start the production server. `/api/health` reports process liveness; `/api/health/ready` returns 200 only with required secrets and the current database migration version, otherwise 503. Monitor readiness, API error counts, request IDs and job failures.
10. With separate worker and owner test accounts, exercise signup/confirmation, login/recovery, profile/video upload, KYC upload/review, gig application/assignment, inbox, credentials/review, scheduled work submission, UPI verification, payout request/approval/rejection and feedback. Verify the worker cannot access another worker's records. Only mark a test payout paid when an actual test transfer/reference has been reconciled.

## Operational contracts

- Admin UPI verification records an explicit manual check. There is no automatic UPI ownership provider. Changing the UPI ID clears verification, and active payouts freeze the payout destination.
- Payout APIs reserve eligible earnings and record a manual transfer. They do not send money to a bank or payment provider. Approval moves a batch to Processing; Paid requires a unique payment reference. Rejection releases the reservation; Paid cannot be rejected.
- Lifecycle email is sent after the database action. Delivery failure is reported separately and does not roll back the application/review. There is no automatic email retry queue; operations must monitor failed notifications and retry the relevant notification action.
- Financial and verification history is preserved. Accounts and workers with history cannot be permanently deleted through the legacy delete buttons. Unassign accounts to stop new scheduled work. If deleting an unused Auth user fails after preparation, the account remains disabled until an administrator retries deletion.
- Account assignments, scheduling, KYC decisions, application decisions, credentials and payouts use transaction functions. The browser cannot call privileged functions directly. Service keys must remain on trusted servers.
- Private presentation URLs expire after one hour; KYC links after ten minutes. Refresh the relevant dashboard to obtain new links. All mailbox addresses are permanently reserved, including addresses whose account was deleted, to prevent ownership reuse.
- List endpoints use bounded result sets (Supabase's configured API row limit; snapshots cap work at 1,000). Worker totals are computed in PostgreSQL, rather than summing a truncated browser list. Size the API row limit and add UI pagination before operating beyond that display capacity.
- Back up the database and storage together, define a retention policy for identity documents and inbox contents, and test restore with the encryption key available. Production TLS, provider rate limiting, logs/alerts, scheduler and backups belong to the deployment environment.

## Dependencies

Next.js, Supabase client packages and mail libraries were updated, and runtime dependencies were audited separately from development tooling. The remaining development-only audit chain is `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. The registry's suggested force fix downgrades Next's lint configuration to a different major release; it was not applied. Track an upstream compatible fix and do not run the development server as production.
