# Administrator credentials from `.env`

The administrator signs in through the existing email/password login. Supabase Auth verifies the password; the application grants administrator access only when the verified Auth user matches both `ADMIN_EMAIL` and the service-managed `admin_owner` record. There is no environment-password login bypass or public setup endpoint.

## Configuration

Keep these values in the ignored `.env` or the deployment secret manager:

```dotenv
ADMIN_EMAIL=your-admin@example.com
ADMIN_PASSWORD=your-strong-unique-password
ADMIN_NAME=Reelencer Admin
```

`ADMIN_PASSWORD` must be 16–128 characters and satisfy your Supabase project's password policy. A strong random password has been generated in this workspace's private `.env`, alongside the previous administrator email. It has not been printed in command output or committed. Open the file locally to retrieve or replace it. The file is readable/writable only by its owner.

The setup commands load `.env` and then `.env.local`; the latter overrides duplicate names. Environment variables already injected by the deployment platform take precedence over both files. Avoid defining the admin keys in both files. Never use `NEXT_PUBLIC_` for administrator configuration, and do not add credentials to `next.config`'s `env` section.

## Provision or update the account

Use Node.js 22. Supply the reachable project's Supabase URL, service-role key and `DATABASE_URL`, then run:

```bash
npm run db:migrate
npm run admin:check
npm run admin:sync
npm run check:backend
```

`admin:check` is read-only. It validates local configuration and checks whether the account and administrator registration exist; it does not try the password or change it.

`admin:sync` is an explicit credential update. It checks migration version 3 before any Auth write, searches for an existing user by normalized email, then creates that user or updates the existing user's password from `ADMIN_PASSWORD`. Existing account IDs, metadata and work history are preserved. Suspended Auth accounts must be resolved before provisioning. The provisioned email is marked confirmed through Supabase's server-side [createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser) or [updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid) API; no invitation email is sent by this command.

After Auth succeeds, a restricted database transaction enrolls that exact user, updates its profile and records an audit event. It verifies the previous owner's identity to reject overlapping ownership changes. Setup returns only status and the user ID. Passwords are never sent to application tables, audit events or browser code.

The command does not run on startup, during builds, or on ordinary requests. Sign in at `/login` with the email and password from `.env` after provisioning succeeds. Environment credentials do not work offline when Supabase is unavailable.

## Password and owner changes

To update the password, change `ADMIN_PASSWORD` and run `npm run admin:sync` deliberately. To change the owner, update both `ADMIN_EMAIL` and `ADMIN_PASSWORD`, run the command, and deploy/restart application instances with the matching `ADMIN_EMAIL`. The former owner loses administrator privileges at the database layer, even on application instances still using the old environment. No user or work history is deleted. Existing browser role caches cannot authorize API requests.

If the password is changed using Supabase's recovery flow, update your stored environment credential before the next `admin:sync`, or that command will deliberately reset it to the environment value. The app needs only `ADMIN_EMAIL` during normal operation; `ADMIN_PASSWORD` can be supplied solely to the operator's setup job.

Auth and PostgreSQL cannot share one transaction. A failed command reports whether Auth was already updated. A timeout can hide a committed database change, so setup never automatically deletes or rolls back an Auth user. Inspect `admin:check`, resolve the reported problem and rerun with the intended configuration. Do not run conflicting setup jobs with different credentials concurrently.

## Current workspace status

On 2026-10-05, the Supabase API and database became reachable. The existing PostgreSQL connection is configured as `DATABASE_URL` in the private `.env`, with `DATABASE_SSL_CA_FILE` supplying Supabase's verified public root certificate. A private backup and successful rollback rehearsal preceded the compatibility and backend migrations.

Live `admin:sync` then succeeded and updated the existing administrator's password without changing its Auth user ID. A real sign-in with the credentials from `.env` succeeded; the application returned the admin role from `/api/me`, served `/api/admin/snapshot`, and reported ready from `/api/health/ready`. `npm run check:backend` also passed. The environment credentials are now active. No password or access token was printed during verification.

## Recovering an unreachable project

Run `npm run check:backend`; a failed `supabase_dns` check means the application cannot reach the project, before any password verification takes place. Open the project in the Supabase dashboard and inspect its actual status. DNS failure alone cannot distinguish a paused, deleted, mistyped or incorrectly provisioned project.

- If paused, use **Resume project** and wait for recovery; see [Supabase's restore instructions](https://supabase.com/docs/guides/platform/free-project-pausing).
- If the project is missing or replaced, copy the replacement project's API URL, public anon/publishable key, service key and PostgreSQL connection into the private environment files. All four must belong to the same project. Preserve existing data and recover from its backups before switching production to a replacement.
- If the dashboard reports a healthy project but its hostname still returns `NXDOMAIN` from multiple public resolvers, contact Supabase support with the project reference and DNS results.

This workspace defines Supabase variables in both `.env` and `.env.local`. Keep them consistent or remove stale duplicate definitions; `.env.local` takes precedence. After a URL or public key change, restart `npm run dev`, or rebuild and restart production. Once DNS and connectivity recover, apply the reviewed migrations, run `npm run admin:sync`, and repeat `npm run check:backend` before testing login.
