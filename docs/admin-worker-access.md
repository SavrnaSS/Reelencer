# Worker access controls

Open **Admin → Workers**, select a user, and use **Access & safety**.

- **Suspend access** disables protected application actions on existing and future sessions. Work, assignments, identity checks, and payments remain available to administrators.
- **Suspend + block IP** also blocks one explicitly selected, previously captured public IP. The confirmation requires a reason and acknowledgement that shared networks affect other users. A user's current address cannot be inferred from an email address; old addresses are not invented or backfilled.
- **Unblock** removes the selected block recorded for that user without restoring their account. Independent blocks for the same address remain effective.
- **Delete user** disables access immediately and schedules permanent removal after seven complete days. It requires the exact displayed worker ID and a reason. The Deleted filter shows the removal deadline and the remaining restore window.
- **Restore access** reactivates the account, cancels its scheduled permanent removal and removes IP blocks recorded for that account. Restoration remains available until permanent cleanup starts. Blocks recorded for other accounts still apply. Review outstanding assignments before restoring.

Actions require the verified administrator identity. Self moderation and administrator targets are rejected. Each change records the actor, reason, previous state, time, and relevant address in protected audit records. Records for deleted users remain available during the seven-day restore window and are removed by permanent cleanup. Concurrent changes serialize on the target profile; retries that already match its state do not create duplicate changes or extend a deletion deadline.

Suspension stops new assignments and planned work. The scheduler skips inactive workers and continues processing active workers. Suspended accounts keep their records; the seven-day removal policy applies to accounts explicitly marked Deleted.

Overview snapshots, assignment lists and work selectors show current workers only. The admin worker API excludes Deleted accounts by default; the restoration directory explicitly requests `includeDeleted=true`. Deleted accounts therefore stay available in the Workers management view without occupying overview cards or operational pickers. Snapshot history keeps its original worker aliases and approved earnings. A deletion arriving during a refresh queues another read so stale results cannot remain until the next poll.

## Application visibility

Apply `202610250003_current_worker_applications.sql` with the application update. Deleted workers leave the Applications queue, its counts, gig applicant totals, bulk selections and automation matches immediately. Their retained applications are still stored during the seven-day restore window and reappear when access is restored. The service-only `current_gig_applications` view resolves current identities by worker code, user ID and legacy email or encoded owner metadata; records without a current identity remain outside the operational queue. Reads filter before pagination, and database guards reject stale application updates after deletion. Moderation and cleanup events refresh the queue automatically.

## Automatic permanent removal

Apply `202610250002_worker_permanent_deletion.sql`. Existing Deleted users are queued using their original `deleted_at`, so a deployment does not restart or shorten their seven-day window. Each deadline is exactly 168 hours after deletion. A background job runs after that deadline; no force/early-delete endpoint is exposed.

Cleanup removes the user's nested uploads and archived file versions through the Supabase Storage API, including KYC documents and presentation videos. It uses both object ownership and exact user/worker path segments, so service-uploaded files are included. It verifies that storage is empty before calling the Auth API for hard deletion. A database trigger removes owned records in that same Auth transaction: profiles, directory records, work, payouts and view claims, identity checks, linked-account analytics, applications, credentials, inboxes, feedback, IP records and user-specific audit data. Links to shared team accounts and gigs are detached. Multi-user bulk results have only the erased user's entry removed. Completed cleanup jobs retain anonymous timestamps/counts and erase their user ID, aliases and lease token.

Claims use short exclusive leases; interrupted work resumes after lease expiry. Storage/network failures leave a retryable job with bounded exponential backoff. Partial storage removal is idempotent. An Auth/database failure rolls back the database erasure, and a lost response is recovered from the committed job state. The profile stays disabled throughout. Once cleanup starts, both individual and bulk restoration are blocked atomically to prevent restoring a partially erased account. Administrators, active users and ambiguous worker aliases are excluded from the cleanup queue.

Local development starts the cleanup scheduler automatically through `instrumentation.ts`; restart the running server when installing it. Set `WORKER_PURGE_IN_PROCESS=false` to disable it locally. Long-running production Node hosts can explicitly enable it with `WORKER_PURGE_IN_PROCESS=true`. Serverless hosts must schedule an authenticated POST to `/api/jobs/worker-purge` every minute with the existing `CRON_SECRET` bearer token. The Cloudflare worker includes `WORKER_PURGE_URL` in `wrangler.toml`; deploy the updated app and worker with the matching secret. Its sync and deletion jobs run independently, so one failed job does not prevent the other from completing.

`npm run purge:workers:check` reports pending/due/retrying counts and the scheduler heartbeat without exposing user data. `npm run purge:workers` processes only accounts already due. Large file collections are handled in bounded batches across successive minute ticks. The admin directory receives private invalidations after cleanup, with polling as a fallback, and removed users leave its counts and selection automatically.

The policy erases live application data, Supabase account identity and owned storage. Infrastructure backups, provider logs, previously delivered emails, downloaded exports and accounts on external social platforms follow their own retention and deletion processes.

## Bulk user management

Use the directory checkboxes to select users, then choose a bulk action. Opening a user and selecting them for a batch are separate controls. Selection stays across pages, search, and filters; the selected summary shows how many selected users are hidden by the current filters. **Clear selection** clears the entire batch. The batch limit is 100 users.

**Select page** affects the current page. **Select matches** adds matching users up to the 100-user limit. Neither control selects users arriving in a later refresh automatically. Directory filters cover access status, assigned accounts, and payment verification, with sorting by name, earnings, assigned accounts, or submissions. The Deleted filter shows archived users, and All records includes every access status. The selected CSV includes only selected users and escapes spreadsheet formula cells.

Bulk suspension, suspension with IP blocking, restoration, and deletion all start with a read-only review. The review lists exact targets, eligible and skipped users, and a reason for each skip. IP blocking selects one recently captured eligible public address per user and displays it before confirmation; it requires an acknowledgement about shared networks. Users without a safe captured IP are skipped. Bulk deletion requires typing **DELETE N USERS**, where N is the eligible count, and schedules the same seven-day permanent-removal policy for each user.

Reviews expire after ten minutes. The server signs each review for the administrator, action, user identities, access state, and relevant IP. Each eligible user's current identity, access flags, and moderation version are checked again while holding the account lock. A concurrent access change causes that user to be skipped and reviewed again. One rejected user does not roll back successful users in the batch.

Each submitted operation has an immutable operation ID and saved per-user results. The changes and saved result commit together. If the browser loses the response, it can recover the result by operation ID or retry the exact same reviewed request without repeating completed changes. A missing result alone does not prove the original request failed. The UI retains an unresolved operation for recovery, and successful results clear only successfully updated users from the selection; skipped or failed users remain available for a fresh review. Each individual change keeps its moderation audit entry, and the batch also records its totals and reason.

## Trusted IP configuration

Apply the migrations before enabling IP capture:

```sh
npm run db:migrate
```

`TRUSTED_CLIENT_IP_HEADER` selects a header overwritten by your ingress proxy. Supported values are `cf-connecting-ip`, `x-real-ip`, `x-forwarded-for`, and `x-vercel-forwarded-for`. A list of forwarded addresses is rejected: configure the ingress to supply one verified client address. On Vercel, `VERCEL=1` automatically selects `x-vercel-forwarded-for`.

For Cloudflare, restrict origin access to trusted ingress before setting `TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip`; otherwise clients could connect directly and spoof the header. See [Cloudflare origin protection](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/) and [Vercel request headers](https://vercel.com/docs/headers/request-headers).

With no configured trusted source, normal account suspension/deletion still works and IP capture is disabled. A configured source with a missing, malformed, private, or reserved IP fails closed for worker requests. The panel disables IP blocking when the administrator's current connection cannot be verified. The current administrator address is protected against blocking, and administrator recovery requests bypass worker IP restrictions.

Verified requests record each worker's public IP and update its last-seen time at most once per minute per address. An address block applies to protected worker API requests and the app's sign-up endpoint across users. Supabase Auth can still issue a session, but the session cannot use protected app APIs while the account or address is restricted. IP blocking is an exact-address restriction; it does not identify a device or prevent the user from changing networks. Private storage and application rows remain protected by the existing service-only permissions.

The migrations add service-only moderation tables and transaction functions. Deploy the application and its database migrations together; restart the server after changing trusted ingress configuration. Startup never initiates a new suspension or deletion request; the cleanup scheduler processes only previously deleted users whose retention period has elapsed.
