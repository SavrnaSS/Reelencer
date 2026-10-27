// Gig discovery, briefs and applications share the dashboard's Find section.
export const FIND_GIGS_HREF = "/dashboard?section=find";

export function findGigHref(gigId: string, intent: "details" | "apply" = "details") {
  const params = new URLSearchParams({ section: "find", gigId });
  if (intent === "apply") params.set("intent", "apply");
  return `/dashboard?${params.toString()}`;
}

// Where creators land after logging in or confirming sign-up: their jobs (applications and assignments).
export const CREATOR_HOME_HREF = "/dashboard?section=jobs";

export type DashboardSection = "profile" | "dashboard" | "jobs" | "find" | "accounts" | "messages" | "wallet";
const DASHBOARD_SECTIONS = new Set<DashboardSection>(["profile", "dashboard", "jobs", "find", "accounts", "messages", "wallet"]);

/** The URL selects the first rendered screen, including legacy bookmarks and application links. */
export function dashboardLocation(query: string) {
  const params = new URLSearchParams(query);
  const section = String(params.get("section") ?? params.get("view") ?? "").trim().toLowerCase() as DashboardSection;
  const candidate = String(params.get("gigId") ?? params.get("gigid") ?? "").trim();
  const gigId = candidate && candidate.length <= 100 ? candidate : null;
  return {
    section: gigId ? "find" as const : DASHBOARD_SECTIONS.has(section) ? section : "jobs" as const,
    gigId,
    intent: gigId && params.get("intent") === "apply" ? "apply" as const : "details" as const,
  };
}

/** Old bookmarks and notification links keep their gig without reviving the retired page. */
export function legacyGigDestination(params: Record<string, string | string[] | undefined>) {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const gigId = (first(params.gigId) || first(params.gigid) || "").trim();
  if (!gigId || gigId.length > 100) return CREATOR_HOME_HREF;
  return findGigHref(gigId, first(params.intent) === "apply" ? "apply" : "details");
}
