import { parseGigRequirementMeta } from "./gigApplicationMode";

// A gig's company logo is stored with the gig's other settings, as a `Meta::company_logo=<https url>` requirement
// line (uploaded from the admin gig form). Without one, the company's initials are shown instead.

const META_PREFIX = "meta::company_logo=";
const MAX_URL_LENGTH = 2048;

/** A logo address that's safe to show: an https URL, nothing else. */
export function usableLogoUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The gig's company logo, or null when the team hasn't added one. */
export function gigLogoUrl(requirements?: readonly string[] | null): string | null {
  return usableLogoUrl(parseGigRequirementMeta(requirements ? [...requirements] : []).company_logo);
}

/** The requirement lines with the logo set to `url`, or removed when it's empty. */
export function withGigLogo(requirements: readonly string[], url: string | null | undefined): string[] {
  const rest = requirements.filter((line) => !String(line).toLowerCase().startsWith(META_PREFIX));
  const logo = usableLogoUrl(url);
  return logo ? [...rest, `Meta::company_logo=${logo}`] : rest;
}
