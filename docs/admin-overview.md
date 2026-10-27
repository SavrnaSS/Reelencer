# Admin activity overview

Overview uses recorded user activity across the platform. It loads independently of the full worker directory and does not run worker scheduling while the page is opened.

The 7, 30 and 90 day views use calendar days in **Asia/Kolkata**. The current day is partial and updates as records arrive. Comparisons use the immediately preceding period of the same length.

- **Total users** counts creator profiles, excluding administrators and deleted users. Suspended users retain their historical activity.
- **Active users** counts distinct people who joined, applied, submitted a reel, made an earnings claim or requested a withdrawal during the period. A person using different stored worker aliases is counted once. The period total is a distinct count, not the sum of daily users.
- **Actions** counts applications, creator-submitted reels, earnings claims and withdrawals. Sign-ups have their own series. Automatically discovered social posts are excluded.
- **Linked accounts** counts currently active and paused social accounts. Unlinked profiles are excluded.
- **Pending payouts** counts pending earnings claims plus Draft/Processing withdrawal requests. Paid and failed withdrawals are excluded.

These are operational records, not page-view or login tracking. No new browser tracking or IP history is collected. Historical records removed through the existing deletion flows are no longer part of these aggregates.

The activity chart supports pointer, touch and keyboard exploration, metric switching, an accessible daily table and CSV export. The CSV contains daily aggregate counts. Recent activity contains only a display name, worker code, event kind and time; emails, credentials and network information are not returned.

The **Needs attention** card shows current queues independently of the selected historical period. Each entry opens its existing admin section. Worker scheduling defaults are under **Workers → Scheduling defaults**.

`/api/admin/activity?days=30` requires the verified administrator. Migration `202610270002_admin_activity_overview.sql` installs `admin_activity_overview`, a read-only service-role function that aggregates in PostgreSQL without a client row cap. It also indexes event timestamps. The original exact-count endpoint remains available for the shared navigation badges.

Responses use private/no-store headers. Reviewed responses may be cached in the authenticated administrator's tab session, with a 15 second freshness window. Reads refresh after relevant live changes, local reviews, reconnects and visible polling. A failed update keeps the last valid response; an unavailable first read displays placeholders and retry controls.
