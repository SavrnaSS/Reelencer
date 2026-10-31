import { formatSlotTime, formatWait } from "./applicationQuota";

// Gigs the team marks "Hold for established creators" open to a creator once they've been assigned another project
// (an approved application or a work assignment on any other gig) or their account is NEW_CREATOR_HOLD_DAYS days old.
// The database enforces it (supabase/migrations/202610310008_new_creator_gig_hold.sql, which must use the same
// rule); this mirrors it from the creator's own records so the dashboard can explain it before they try.

export const NEW_CREATOR_HOLD_DAYS = 20;
const HOLD_MS = NEW_CREATOR_HOLD_DAYS * 86_400_000;

type GigRef = { gigId?: unknown; gig_id?: unknown };
type ApplicationRef = GigRef & { status?: unknown };

const gigOf = (row: GigRef) => String(row.gigId ?? row.gig_id ?? "").trim();

/**
 * When this creator's hold on a held gig lifts, or null when they can apply now. An unknown account age doesn't
 * hold anyone here; the server still checks.
 */
export function newCreatorHoldUntil(input: {
  gigId: string;
  held: boolean | undefined;
  accountCreatedAt: string | null | undefined;
  applications: readonly ApplicationRef[];
  assignments: readonly GigRef[];
  now?: number;
}): string | null {
  if (!input.held) return null;
  const created = Date.parse(String(input.accountCreatedAt ?? ""));
  if (!Number.isFinite(created)) return null;
  const opensAt = created + HOLD_MS;
  if (opensAt <= (input.now ?? Date.now())) return null;
  const gigId = String(input.gigId);
  // Already approved for this gig: the hold never applies to it.
  if (input.applications.some(a => gigOf(a) === gigId && String(a.status ?? "").toLowerCase() === "accepted")) return null;
  const assignedElsewhere =
    input.assignments.some(a => gigOf(a) && gigOf(a) !== gigId) ||
    input.applications.some(a => gigOf(a) && gigOf(a) !== gigId && String(a.status ?? "").toLowerCase() === "accepted");
  return assignedElsewhere ? null : new Date(opensAt).toISOString();
}

export const NEW_CREATOR_HOLD_TITLE = "Open to established creators";

/** `withTime` adds the local date and time; leave it off on the server, which doesn't know the viewer's time zone. */
export function newCreatorHoldMessage(opensAt: string | null | undefined, { now = Date.now(), withTime = true } = {}) {
  const rule = `This gig opens once you've been assigned another project, or ${NEW_CREATOR_HOLD_DAYS} days after you joined.`;
  if (!opensAt || !(Date.parse(opensAt) > now)) return rule;
  return `${rule} Yours opens in ${formatWait(opensAt, now)}${withTime ? ` (${formatSlotTime(opensAt)})` : ""} at the latest.`;
}
