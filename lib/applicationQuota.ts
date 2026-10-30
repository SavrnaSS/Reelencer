// Creators can apply to at most WEEKLY_APPLICATION_LIMIT gigs in any rolling APPLICATION_WINDOW_DAYS days. The
// database enforces it (supabase/migrations/202610300001_weekly_application_limit.sql, which must use the same
// numbers); this mirrors the rule from the creator's own applications so the dashboard can show it live.
// A gig uses a slot from its latest application until 7 days later. Withdrawn or declined applications still
// count, and re-submitting or revising a gig that's already counted doesn't use another slot.

export const WEEKLY_APPLICATION_LIMIT = 2;
export const APPLICATION_WINDOW_DAYS = 7;
const WINDOW_MS = APPLICATION_WINDOW_DAYS * 86_400_000;

export type ApplicationQuota = {
  limit: number;
  windowDays: number;
  used: number;
  remaining: number;
  /** When the limit is reached: the moment the next slot opens. */
  nextSlotAt: string | null;
  /** Gigs using a slot, oldest first, with when each one frees up. */
  gigs: Array<{ gigId: string; appliedAt: string; freesAt: string }>;
};

export function applicationQuota(applications: ReadonlyArray<{ gigId?: unknown; appliedAt?: unknown }>, now = Date.now()): ApplicationQuota {
  const latest = new Map<string, number>();
  for (const application of applications) {
    const gigId = String(application.gigId ?? "").trim();
    const at = Date.parse(String(application.appliedAt ?? ""));
    if (!gigId || !Number.isFinite(at) || at <= now - WINDOW_MS || at > now + 60_000) continue;
    latest.set(gigId, Math.max(latest.get(gigId) ?? 0, at));
  }
  const gigs = [...latest].sort((a, b) => a[1] - b[1]).map(([gigId, at]) => ({ gigId, appliedAt: new Date(at).toISOString(), freesAt: new Date(at + WINDOW_MS).toISOString() }));
  const used = gigs.length;
  const limit = WEEKLY_APPLICATION_LIMIT;
  return { limit, windowDays: APPLICATION_WINDOW_DAYS, used, remaining: Math.max(limit - used, 0), nextSlotAt: used >= limit ? gigs[used - limit].freesAt : null, gigs };
}

/** The stricter of the dashboard's own count and the server's answer (which also sees applications it can't). */
export function strictestQuota(local: ApplicationQuota, server: ApplicationQuota | null, now = Date.now()): ApplicationQuota {
  if (!server || server.remaining >= local.remaining) return local;
  // A server answer only holds until its next slot opens; after that the local count takes over again.
  if (server.nextSlotAt && Date.parse(server.nextSlotAt) <= now) return local;
  return server;
}

/** Applying to this gig doesn't use a new slot: it's already counted (re-submitting or revising). */
export const quotaCoversGig = (quota: ApplicationQuota, gigId: string) => quota.gigs.some((gig) => gig.gigId === String(gigId));

/** Whether applying to this gig is blocked by the weekly limit right now. */
export const quotaBlocksGig = (quota: ApplicationQuota, gigId: string) => quota.remaining === 0 && !quotaCoversGig(quota, gigId);

/** "2d 4h", "3h 20m", "12m" until the given time. */
export function formatWait(iso: string | null | undefined, now = Date.now()) {
  const ms = Date.parse(String(iso ?? "")) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const minutes = Math.ceil(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** "Sat 1 Nov, 9:15 pm" in the viewer's own time zone. */
export function formatSlotTime(iso: string | null | undefined) {
  const date = new Date(String(iso ?? ""));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** `withTime` adds the local date and time; leave it off on the server, which doesn't know the viewer's time zone. */
export function quotaLimitMessage(quota: ApplicationQuota, { now = Date.now(), withTime = true } = {}) {
  const when = quota.nextSlotAt ? ` Your next one opens in ${formatWait(quota.nextSlotAt, now)}${withTime ? ` (${formatSlotTime(quota.nextSlotAt)})` : ""}.` : "";
  return `You've used both of this week's applications.${when}`;
}
