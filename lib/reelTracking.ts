// Reels count from the day their account was linked, in India time: a reel that went live earlier that day counts,
// one from the day before doesn't. Earlier reels are never discovered, refreshed, approved or paid. The database
// applies the same rule (public.reel_tracking_start) to approvals and view payout claims.

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

export const BEFORE_LINK_NOTE = "Posted before this account was linked. Only reels posted from the day it was linked count.";

/** Midnight (India time) at the start of the day the account was linked, as epoch ms. */
export function trackingStart(linkedAt: string | number | null | undefined): number | undefined {
  const time = typeof linkedAt === "number" ? linkedAt : Date.parse(String(linkedAt ?? ""));
  if (!Number.isFinite(time)) return undefined;
  const local = time + IST_OFFSET_MS;
  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - IST_OFFSET_MS;
}

/** "29 Oct 2026": the linking day as shown to people. */
export function trackingStartLabel(linkedAt: string | number | null | undefined) {
  const start = trackingStart(linkedAt);
  return start === undefined ? "" : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(start));
}

/** "2026-10-29": the linking day for a date input's `min`. */
export function trackingStartInput(linkedAt: string | number | null | undefined) {
  const start = trackingStart(linkedAt);
  return start === undefined ? undefined : new Date(start + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export type ReelTracking = "tracked" | "before_link" | "undated";

/** Whether a reel falls inside its account's tracking window. Undated reels are kept, flagged for a check. */
export function reelTracking(postedAt: string | null | undefined, linkedAt: string | number | null | undefined): ReelTracking {
  const posted = Date.parse(String(postedAt ?? ""));
  if (!Number.isFinite(posted)) return "undated";
  const start = trackingStart(linkedAt);
  return start !== undefined && posted < start ? "before_link" : "tracked";
}

/** Reels that exist for creators and pay: not removed by the team and not from before the account was linked. */
export function countedReels<T extends { postedAt?: string; removedAt?: string }>(posts: readonly T[], linkedAt: string | number | null | undefined): T[] {
  return posts.filter((post) => !post.removedAt && reelTracking(post.postedAt, linkedAt) !== "before_link");
}
