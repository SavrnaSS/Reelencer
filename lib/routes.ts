// Gig discovery, briefs and applications share the dashboard's Find section.
export const FIND_GIGS_HREF = "/dashboard?section=find";

export function findGigHref(gigId: string, intent: "details" | "apply" = "details") {
  const params = new URLSearchParams({ section: "find", gigId });
  if (intent === "apply") params.set("intent", "apply");
  return `/dashboard?${params.toString()}`;
}

// Where creators land after logging in or confirming sign-up: their jobs (applications and assignments).
export const CREATOR_HOME_HREF = "/dashboard?section=jobs";

/** Old bookmarks and notification links keep their gig without reviving the retired page. */
export function legacyGigDestination(params: Record<string, string | string[] | undefined>) {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const gigId = (first(params.gigId) || first(params.gigid) || "").trim();
  if (!gigId || gigId.length > 100) return CREATOR_HOME_HREF;
  return findGigHref(gigId, first(params.intent) === "apply" ? "apply" : "details");
}
