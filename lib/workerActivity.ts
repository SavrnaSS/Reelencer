// What each creator has done on gigs, for the admin Workers directory's filters: their applications, where each
// Content Posting account setup stands, KYC and when they joined. Built by /api/admin/worker-activity; matched here.

export type SetupStage =
  /** Not a Content Posting gig, or the application is closed. */
  | "none"
  /** Applied, but hasn't entered the account username yet. */
  | "not_started"
  /** Sent the username; the code isn't in the bio yet. */
  | "code_missing"
  /** Sent the username; the bio couldn't be read automatically, so the team checks it. */
  | "unreadable"
  /** Ownership confirmed (or left to the team): waiting for the team's review. */
  | "awaiting_review"
  | "changes_requested"
  | "verified";
export type KycStage = "none" | "pending" | "approved" | "rejected";
export type ActivityApplication = { gigId: string; status: string; appliedAt: string; setup: SetupStage; handle?: string; code?: string };
export type WorkerActivity = { joinedAt?: string; kyc: KycStage; applications: ActivityApplication[] };
export type ActivityGig = { id: string; title: string; company: string; gigType: string };

export type ApplicationFilter = "all" | "applied" | "never" | "pending" | "accepted" | "rejected";
export type SetupFilter = "all" | Exclude<SetupStage, "none">;
export type KycFilter = "all" | KycStage;
export type JoinedFilter = "all" | "7d" | "30d" | "new" | "established";
export type ActivityFilters = { gig: string; application: ApplicationFilter; setup: SetupFilter; kyc: KycFilter; joined: JoinedFilter };

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = { gig: "all", application: "all", setup: "all", kyc: "all", joined: "all" };
/** Matches the new-creator gig hold (lib/newCreatorHold). */
const NEW_CREATOR_DAYS = 20;

export const SETUP_LABELS: Record<Exclude<SetupStage, "none">, string> = {
  not_started: "Hasn't added username",
  code_missing: "Code not in bio yet",
  unreadable: "Bio couldn't be read",
  awaiting_review: "Sent for checking",
  changes_requested: "Changes requested",
  verified: "Account verified",
};

/** Where a Content Posting application's account setup stands. */
export function setupStage(input: { contentPosting: boolean; status: string; setup?: { status?: string; ownership?: string } | null }): SetupStage {
  if (!input.contentPosting) return "none";
  const status = input.status.toLowerCase();
  if (status === "accepted" || input.setup?.status === "Verified") return "verified";
  if (status === "rejected" || status === "withdrawn") return "none";
  if (!input.setup) return "not_started";
  if (input.setup.status === "ChangesRequested") return "changes_requested";
  if (input.setup.ownership === "found" || input.setup.ownership === "manual") return "awaiting_review";
  if (input.setup.ownership === "unreadable") return "unreadable";
  return "code_missing";
}

function applicationMatches(application: ActivityApplication, filters: ActivityFilters) {
  const status = application.status.toLowerCase();
  if (filters.application === "pending" && status !== "pending") return false;
  if (filters.application === "accepted" && status !== "accepted") return false;
  if (filters.application === "rejected" && status !== "rejected") return false;
  if (filters.setup !== "all" && application.setup !== filters.setup) return false;
  return true;
}

/** Whether a creator matches the activity filters. With a gig chosen, application filters look at that gig only. */
export function matchesActivity(activity: WorkerActivity | undefined, filters: ActivityFilters, now = Date.now()) {
  const record = activity ?? { kyc: "none" as KycStage, applications: [] };
  if (filters.kyc !== "all" && record.kyc !== filters.kyc) return false;
  if (filters.joined !== "all") {
    const joined = Date.parse(record.joinedAt ?? "");
    if (!Number.isFinite(joined)) return false;
    const days = (now - joined) / 86_400_000;
    if (filters.joined === "7d" && days > 7) return false;
    if (filters.joined === "30d" && days > 30) return false;
    if (filters.joined === "new" && days >= NEW_CREATOR_DAYS) return false;
    if (filters.joined === "established" && days < NEW_CREATOR_DAYS) return false;
  }
  const scoped = filters.gig === "all" ? record.applications : record.applications.filter(application => application.gigId === filters.gig);
  if (filters.application === "never") return scoped.length === 0;
  const needsApplication = filters.gig !== "all" || filters.application !== "all" || filters.setup !== "all";
  if (!needsApplication) return true;
  return scoped.some(application => applicationMatches(application, filters));
}

export function activeActivityFilterCount(filters: ActivityFilters) {
  return (Object.keys(DEFAULT_ACTIVITY_FILTERS) as Array<keyof ActivityFilters>).filter(key => filters[key] !== DEFAULT_ACTIVITY_FILTERS[key]).length;
}

/** One-tap views for the most common follow-ups. */
export const ACTIVITY_PRESETS: Array<{ id: string; label: string; filters: Partial<ActivityFilters> }> = [
  { id: "awaiting", label: "Sent accounts to check", filters: { setup: "awaiting_review" } },
  { id: "no_username", label: "Haven't added username", filters: { setup: "not_started" } },
  { id: "code", label: "Code not in bio", filters: { setup: "code_missing" } },
  { id: "unreadable", label: "Bio unreadable", filters: { setup: "unreadable" } },
  { id: "changes", label: "Changes requested", filters: { setup: "changes_requested" } },
  { id: "pending", label: "Applications pending", filters: { application: "pending" } },
  { id: "kyc", label: "KYC pending", filters: { kyc: "pending" } },
  { id: "never", label: "Never applied", filters: { application: "never" } },
  { id: "new", label: "Joined this week", filters: { joined: "7d" } },
];

/** The application a creator matched the filters on: the reason they're in the list, and what to personalise with. */
export function matchedApplication(activity: WorkerActivity | undefined, filters: ActivityFilters, now = Date.now()) {
  if (!activity || filters.application === "never") return undefined;
  return activity.applications.find(application => matchesActivity({ ...activity, applications: [application] }, filters, now));
}

export const presetFilters = (preset: (typeof ACTIVITY_PRESETS)[number]): ActivityFilters => ({ ...DEFAULT_ACTIVITY_FILTERS, ...preset.filters });
export const isPresetActive = (preset: (typeof ACTIVITY_PRESETS)[number], filters: ActivityFilters) =>
  (Object.keys(DEFAULT_ACTIVITY_FILTERS) as Array<keyof ActivityFilters>).every(key => presetFilters(preset)[key] === filters[key]);
