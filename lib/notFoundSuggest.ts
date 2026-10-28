import { CREATOR_HOME_HREF, FIND_GIGS_HREF } from "./routes";

// The 404 page suggests the public page a mistyped or outdated URL most likely meant ("/singup" → Create account).

export type PageSuggestion = { href: string; label: string };

const PAGES: Array<PageSuggestion & { aliases: string[] }> = [
  { href: "/signup", label: "Create account", aliases: ["signup", "register", "join", "create-account", "sign-up"] },
  { href: "/login", label: "Sign in", aliases: ["login", "signin", "sign-in", "log-in"] },
  { href: "/reset-password", label: "Reset password", aliases: ["reset-password", "forgot-password", "password", "reset"] },
  { href: FIND_GIGS_HREF, label: "Find gigs", aliases: ["gigs", "find", "browse", "jobs-board", "find-gigs", "browse-gigs"] },
  { href: CREATOR_HOME_HREF, label: "My jobs", aliases: ["dashboard", "jobs", "my-jobs", "workspace", "my-assignments", "assignments"] },
  { href: "/payouts", label: "Payouts", aliases: ["payouts", "payout", "wallet", "earnings", "withdraw", "kyc"] },
  { href: "/terms", label: "Terms of Service", aliases: ["terms", "tos", "terms-of-service", "terms-and-conditions"] },
  { href: "/privacy", label: "Privacy Policy", aliases: ["privacy", "privacy-policy", "policy"] },
];

/** Edit distance where swapping two neighbouring letters ("singup") counts as one typo. */
function distance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

/** The closest known page for a missing path, or null when nothing is a confident match. */
export function suggestPage(pathname: string): PageSuggestion | null {
  let first = "";
  try {
    first = decodeURIComponent(pathname).toLowerCase().split(/[?#]/)[0].split("/").filter(Boolean)[0] ?? "";
  } catch {
    return null;
  }
  first = first.replace(/[_\s]+/g, "-").replace(/\.(html?|php|aspx?)$/, "");
  if (!first || first.length > 40) return null;
  let best: { page: PageSuggestion; score: number } | null = null;
  for (const page of PAGES) {
    for (const alias of page.aliases) {
      // Allow roughly one typo per four characters, so short words need to be close.
      const score = distance(first, alias);
      if (score <= Math.max(1, Math.floor(alias.length / 4)) && (!best || score < best.score)) best = { page: { href: page.href, label: page.label }, score };
    }
  }
  return best?.page ?? null;
}
