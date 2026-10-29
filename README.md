# Reelencer

A Next.js application for creator onboarding, gigs, account assignments, work review, private inboxes and payouts. Supabase provides Auth, PostgreSQL and Storage; a Cloudflare email worker forwards inbound mail to the authenticated ingest endpoint.

## Local setup

Use Node.js 22 (`.nvmrc`). The application runs against a real Supabase project by default.

```bash
nvm use
npm ci
cp .env.example .env.local
```

Fill in the public Supabase URL/key, server service key, PostgreSQL `DATABASE_URL`, canonical application URL and email transport. Generate independent secrets for `WORK_EMAIL_CRYPTO_SECRET`, `GIG_INBOX_INGEST_SECRET` and `CRON_SECRET` using `openssl rand -hex 32`. Keep `.env.local` private and back up the encryption key. Never replace an existing key without migrating its encrypted data.

For a new or reviewed staging database:

```bash
npm run db:migrate
npm run check:backend
npm run dev
```

For an existing database, read [the migration and release procedure](docs/production-readiness.md) first. Migrations install the canonical schema, transaction functions, row-level security and storage buckets. Recognized legacy layouts are upgraded with guarded conversions and history preservation; incompatible ownership or values stop the migration for review. Supply `DATABASE_SSL_CA_FILE` or `DATABASE_SSL_CA` when the database uses Supabase's private certificate authority. The current project's migrations and administrator setup have been applied and verified.

Workers sign up and verify their email before signing in. Login bootstraps their profile through `/api/bootstrap-profile`. Configure `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_NAME` in the ignored `.env`, apply migrations, then run `npm run admin:sync` to create or update the administrator. Both the server environment and the registered database identity must agree before admin access is granted. The browser obtains the role from the authenticated API. See [administrator setup](docs/admin-setup.md).

Existing-account reminder emails contain a Supabase single-use sign-in link that opens the authenticated workspace without asking for a password. The sign-in and reset buttons share one current credential, since generating a separate recovery token would invalidate the magic link. New credentials travel in the URL fragment and are removed before navigation; previously sent confirmation and recovery query links remain supported. Unknown resend addresses do not create accounts. Match `NEXT_PUBLIC_AUTH_LINK_HOURS` to Supabase's email OTP expiration setting.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development app on port 3000 |
| `npm run check` | Route types, TypeScript, backend tests and backend lint |
| `npm test` | API authorization and PostgreSQL transaction regression tests |
| `npm run db:migrate` | Apply all pending migrations atomically with checksums |
| `npm run db:migrate -- --status` | List applied and pending migrations without changing anything |
| `npm run db:migrate -- --baseline-through <name>` | Record migrations up to `<name>` as applied without running them (for a database migrated by hand) |
| `npm run db:migrate -- --only <name>[,<name>]` | Apply only the named pending migrations |
| `npm run check:backend` | Read-only environment, schema and storage readiness checks |
| `npm run admin:check` | Inspect admin configuration and account registration without changing credentials |
| `npm run admin:sync` | Explicitly provision/update the administrator from `.env` |
| `npm run credentials:check` | Validate the encryption key and count legacy plaintext credentials |
| `npm run credentials:migrate` | Encrypt legacy plaintext credentials after validation |
| `npm run build` / `npm start` | Build and serve the production app |

Tests use a mock HTTP transport and local PGlite database; they require no live service credentials. The full frontend lint command remains `npm run lint`; the backend check has its own lint target.

The development and production build commands use Webpack. This also supports restricted build environments where Turbopack's CSS compiler cannot open a local port.

## Backend contracts

Client API calls attach the current verified Supabase bearer token only to same-origin `/api/` requests. `lib/api/route.ts` supplies authentication, authorization, input size limits, rate limiting, safe errors and request IDs. Database transactions enforce work, assignment, KYC and payout state changes. Sensitive tables and RPC functions are inaccessible directly to browser roles.

Worker IDs shown in the interface are aliases; canonical ownership is the Supabase Auth UUID. Client-supplied worker IDs never authorize access. Uploads validate size, file signatures and ownership. KYC and presentation media are private; gig brief media is intentionally public. Account passwords are encrypted with authenticated AES-256-GCM before storage.

Payouts use an approval and reconciliation workflow. The APIs **do not initiate bank transfers**. UPI verification is an explicit administrator action, and marking a batch paid requires a payment reference.

## Inbox and scheduled work

Set the worker's `GIG_INGEST_SECRET` to match the application's `GIG_INBOX_INGEST_SECRET` and configure `GIG_INGEST_URL` in `wrangler.toml`. Deploy the worker with a configured Wrangler CLI and route your email domains to it. `GIG_ASSIGNMENT_EMAIL_DOMAIN` controls generated gig addresses; `WORK_EMAIL_ALLOWED_DOMAINS` controls work-email addresses. Incoming message IDs are deduplicated, and an address cannot belong to multiple accounts or be reused after deletion.

Configure an external scheduler to POST `/api/jobs/schedule` every 15 minutes using the `CRON_SECRET` bearer token. This job is idempotent and creates upcoming work without mutating data during dashboard reads.

Linked-account statistics use `/api/jobs/social-sync` every minute with the same service authentication. Instagram checks run every five minutes and YouTube every thirty minutes, with persistent retry deadlines and exclusive database leases. Local development starts its scheduler automatically; production can use the Cloudflare Cron Trigger in `wrangler.toml` after configuring the worker's `CRON_SECRET`, or an existing external scheduler. Run `npm run social:check` to check the heartbeat and `npm run social:sync` to process due accounts. See [linked-account automatic sync](docs/instagram-profile-sync.md) for connections, fallback behavior and deployment.

Deleted workers receive a seven-day restore window, then `/api/jobs/worker-purge` removes their live files, application records and Auth identity. Local development runs this job automatically; the Cloudflare minute trigger includes it for production. Run `npm run purge:workers:check` to check its queue and heartbeat. See [worker access and permanent deletion](docs/admin-worker-access.md) for retention, restoration, cleanup guarantees and deployment.

Application automation rules (Gig operations → Applications → Automations) run through `/api/jobs/application-automation`. Configure the same scheduler to POST it every 15 minutes with the `CRON_SECRET` bearer token. Each run handles only applications that newly match an enabled rule, at most the rule's per-run limit and 200 in total, and records every application in a per-rule ledger so retries or overlapping runs never process one twice. Rules act as the admin who enabled them and are skipped if that account loses admin access. Every run is listed in the Activity tab.

See [production readiness and outstanding infrastructure checks](docs/production-readiness.md) for setup, credential migration, validation, operational limits and rollout steps.
