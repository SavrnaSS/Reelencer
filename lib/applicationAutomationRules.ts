// Pure rule logic shared by the admin UI (live previews) and the server runner.
// No server or browser APIs here so both sides evaluate rules identically.

export type BulkAction = "Accepted" | "Rejected" | "Pending" | "push";

export type RuleConditions = {
  gigId: string; // "any" or a gig id
  statuses: string[]; // empty = any
  minAgeDays: number | null; // days since last activity
  invite: "any" | "sent" | "missing";
  joined: "any" | "yes" | "no";
  proposal: "any" | "with" | "without";
};

export type MatchableApplication = {
  id: string;
  gigId: string;
  status: string;
  appliedAt: string;
  decidedAt?: string;
  proposal?: {
    pitch?: string;
    approach?: string;
    timeline?: string;
    budget?: string;
    portfolio?: string;
    whatsappLink?: string;
    groupJoinedConfirmed?: boolean;
  };
};

export const ACTIONS: BulkAction[] = ["Accepted", "Rejected", "Pending", "push"];
export const RULE_STATUSES = ["Applied", "Pending", "Accepted", "Rejected", "Withdrawn"];
export const EMPTY_CONDITIONS: RuleConditions = { gigId: "any", statuses: [], minAgeDays: null, invite: "any", joined: "any", proposal: "any" };

const DAY = 86_400_000;

export const lastActivity = (app: MatchableApplication) => new Date(app.decidedAt ?? app.appliedAt).getTime();

export const hasProposal = (app: MatchableApplication) =>
  !!(app.proposal?.pitch || app.proposal?.approach || app.proposal?.timeline || app.proposal?.budget || app.proposal?.portfolio);

export function matchesConditions(app: MatchableApplication, c: RuleConditions, now: number) {
  if (c.gigId !== "any" && String(app.gigId) !== c.gigId) return false;
  if (c.statuses.length && !c.statuses.includes(app.status)) return false;
  if (c.minAgeDays != null && now - lastActivity(app) < c.minAgeDays * DAY) return false;
  const invite = !!app.proposal?.whatsappLink?.trim();
  if (c.invite === "sent" && !invite) return false;
  if (c.invite === "missing" && invite) return false;
  const joined = !!app.proposal?.groupJoinedConfirmed;
  if (c.joined === "yes" && !joined) return false;
  if (c.joined === "no" && joined) return false;
  if (c.proposal === "with" && !hasProposal(app)) return false;
  if (c.proposal === "without" && hasProposal(app)) return false;
  return true;
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Normalises untrusted input (API bodies, stored JSON) into valid conditions. */
export function sanitizeConditions(raw: unknown): RuleConditions {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const days = v.minAgeDays === null || v.minAgeDays === undefined || v.minAgeDays === "" ? null : Number(v.minAgeDays);
  return {
    gigId: typeof v.gigId === "string" && v.gigId.trim() && v.gigId.length <= 100 ? v.gigId.trim() : "any",
    statuses: Array.isArray(v.statuses) ? [...new Set(v.statuses.filter((s): s is string => RULE_STATUSES.includes(String(s))))] : [],
    minAgeDays: days != null && Number.isFinite(days) ? Math.min(365, Math.max(0, Math.floor(days))) : null,
    invite: pick(v.invite, ["any", "sent", "missing"] as const, "any"),
    joined: pick(v.joined, ["any", "yes", "no"] as const, "any"),
    proposal: pick(v.proposal, ["any", "with", "without"] as const, "any"),
  };
}
