/** Shared route and navigation definitions for the administrator console. */
export type GigAdminView =
  | "create-new-gig"
  | "gig-listings"
  | "applications"
  | "kyc-review"
  | "credential-submissions"
  | "linked-accounts";

export type AdminSection =
  | "Overview"
  | "Workers"
  | "Payouts"
  | "Feedback"
  | "Email Access"
  | GigAdminView;

export type AdminSearchParams = Record<string, string | string[] | undefined>;

type AdminNavItem = {
  id: AdminSection;
  label: string;
  icon: string;
  attention?: string;
};

export const ADMIN_NAV_GROUPS: Array<{ label: string; items: AdminNavItem[] }> = [
  {
    label: "Operations",
    items: [
      { id: "Overview", label: "Overview", icon: "grid" },
      { id: "create-new-gig", label: "Create gig", icon: "plus" },
      { id: "gig-listings", label: "Gig listings", icon: "briefcase" },
      { id: "applications", label: "Applications", icon: "users", attention: "awaiting review" },
      { id: "kyc-review", label: "KYC review", icon: "shield", attention: "pending verification" },
      { id: "credential-submissions", label: "Credential submissions", icon: "lock", attention: "submitted for review" },
      { id: "linked-accounts", label: "Linked accounts", icon: "link", attention: "need a check-in or reel review" },
    ],
  },
  {
    label: "People & money",
    items: [
      { id: "Workers", label: "Workers", icon: "users" },
      { id: "Payouts", label: "Payouts", icon: "wallet" },
    ],
  },
  {
    label: "Platform",
    items: [
      { id: "Feedback", label: "Feedback", icon: "comment" },
      { id: "Email Access", label: "Email access", icon: "mail" },
    ],
  },
];

const SECTION_SLUGS: Record<AdminSection, string> = {
  Overview: "overview",
  Workers: "workers",
  Payouts: "payouts",
  Feedback: "feedback",
  "Email Access": "email-access",
  "create-new-gig": "create-new-gig",
  "gig-listings": "gig-listings",
  applications: "applications",
  "kyc-review": "kyc-review",
  "credential-submissions": "credential-submissions",
  "linked-accounts": "linked-accounts",
};

const SECTIONS_BY_SLUG = new Map<string, AdminSection>(
  Object.entries(SECTION_SLUGS).flatMap(([section, slug]) => [
    [slug, section as AdminSection],
    [section.toLowerCase(), section as AdminSection],
  ]),
);

const GIG_SECTIONS = new Set<AdminSection>([
  "create-new-gig", "gig-listings", "applications", "kyc-review", "credential-submissions", "linked-accounts",
]);

export function isGigAdminSection(section: AdminSection): section is GigAdminView {
  return GIG_SECTIONS.has(section);
}

/** Removed, unknown or missing sections open the overview; former Gigs links open listings. */
export function parseAdminSection(search?: string | Pick<URLSearchParams, "get"> | null): AdminSection {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const value = params?.get("section")?.trim().toLowerCase();
  if (value === "gigs") return "gig-listings";
  return (value && SECTIONS_BY_SLUG.get(value)) || "Overview";
}

/** Build a canonical URL without mutating the caller's search parameters. */
export function adminSectionHref(
  section: AdminSection,
  searchParams?: AdminSearchParams | URLSearchParams | string,
): string {
  let params: URLSearchParams;
  if (typeof searchParams === "string" || searchParams instanceof URLSearchParams) {
    params = new URLSearchParams(searchParams);
  } else {
    params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, entry);
    }
  }
  // Set the destination section last so old or repeated section values cannot override it.
  params.set("section", SECTION_SLUGS[section]);
  return `/admin?${params.toString()}`;
}

/** Legacy /addgigs routes retain gig/edit filters while sharing the admin shell. */
export function legacyGigAdminHref(view: GigAdminView, searchParams: AdminSearchParams = {}): string {
  return adminSectionHref(view, searchParams);
}
