// Additional account requests: a creator linked on a Content Posting gig asks to link more accounts on it (each one
// earns at the gig's rate). The server runs automated checks; the team verifies and approves before anything links.
// Pure module: shared by the creator dashboard, the admin console and the API.

export type AccountRequestStatus = "pending" | "changes_requested" | "approved" | "rejected" | "withdrawn";
export type AccountRequestRisk = "low" | "medium" | "high" | "unknown";
/** "pending": waiting on the creator or the team (e.g. code not in the bio yet, manual login check). */
export type RequestCheckStatus = "pass" | "warn" | "fail" | "pending";
export type RequestCheckId = "link" | "ownership" | "profile" | "duplicate" | "email" | "velocity" | "capacity";
export type RequestCheck = { id: RequestCheckId; label: string; status: RequestCheckStatus; detail: string };

export type AccountRequestView = {
  id: string;
  sourceAccountId: string;
  gigId: string;
  gigTitle?: string;
  company?: string;
  payoutPhrase?: string;
  platform: string;
  handle: string;
  profileUrl: string;
  email: string;
  phone?: string;
  notes?: string;
  hasPassword: boolean;
  verifyCode: string;
  status: AccountRequestStatus;
  revision: number;
  checks: RequestCheck[];
  risk: AccountRequestRisk;
  checkedAt?: string;
  reviewNote?: string;
  reviewedAt?: string;
  linkedAccountId?: string;
  submittedAt: string;
  createdAt: string;
};

export type AdminAccountRequest = AccountRequestView & {
  workerCode: string;
  workerName?: string;
  /** The creator's linked (not unlinked) accounts, all gigs. */
  creatorAccounts: number;
  /** Handle of the account this request was made from. */
  sourceHandle?: string;
};

/** A gig the creator can add accounts to: one where they already have an active linked account. */
export type RequestEligibleGig = {
  sourceAccountId: string;
  sourceHandle: string;
  gigId: string;
  gigTitle?: string;
  company?: string;
  platform: string;
  payoutPhrase?: string;
  accountsOnGig: number;
  slotsLeft: number;
};

export type CreatorAccountRequests = {
  requests: AccountRequestView[];
  eligible: RequestEligibleGig[];
  limits: { perGig: number; total: number; open: number; used: number; openUsed: number };
  /** The requests table hasn't been migrated yet. */
  unavailable?: boolean;
};

export const ACCOUNT_REQUEST_LIMITS = {
  /** Linked + open requests on one gig. */
  perGig: 3,
  /** Linked + open requests across every gig. */
  total: 6,
  /** Requests waiting for review at once. */
  open: 2,
  /** Creators can re-run the automated checks this often. */
  recheckSeconds: 60,
  /** Requests a creator may submit in a day before it counts as a risk signal. */
  dailyBurst: 3,
} as const;

/** Waiting longer than this is flagged in the team's queue. */
export const REVIEW_TARGET_HOURS = 24;

export const OPEN_REQUEST_STATUSES: AccountRequestStatus[] = ["pending", "changes_requested"];

export const REQUEST_STATUS_LABEL: Record<AccountRequestStatus, string> = {
  pending: "In review",
  changes_requested: "Changes needed",
  approved: "Linked",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
};

/** Random, unambiguous characters (no 0/O, 1/I). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeVerifyCode(random: (n: number) => Uint8Array) {
  return `RL-${Array.from(random(6), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("")}`;
}

/** Overall risk from the checks: any failure is high; proven ownership with nothing odd is low. */
export function riskFrom(checks: RequestCheck[]): AccountRequestRisk {
  if (!checks.length) return "unknown";
  if (checks.some((check) => check.status === "fail")) return "high";
  const warns = checks.filter((check) => check.status === "warn").length;
  const owned = checks.find((check) => check.id === "ownership")?.status === "pass";
  if (owned) return warns ? "medium" : "low";
  return warns >= 2 ? "high" : "medium";
}

export const RISK_LABEL: Record<AccountRequestRisk, string> = { low: "Low risk", medium: "Needs a look", high: "High risk", unknown: "Not checked" };

/** Step index for the creator's progress tracker: submitted → checks → team review → linked. */
export function requestStep(request: Pick<AccountRequestView, "status" | "checks">) {
  if (request.status === "approved") return 3;
  const owned = request.checks.find((check) => check.id === "ownership")?.status === "pass";
  return owned || request.status === "rejected" ? 2 : 1;
}
