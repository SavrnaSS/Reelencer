export type GigApplicationMode = "apply" | "proposal";

export function parseGigRequirementMeta(requirements?: string[] | null) {
  const rows = Array.isArray(requirements) ? requirements : [];
  return rows
    .filter((item) => String(item).toLowerCase().startsWith("meta::"))
    .reduce<Record<string, string>>((acc, item) => {
      const clean = String(item).replace(/^meta::/i, "");
      const sep = clean.indexOf("=");
      if (sep > 0) {
        const key = clean.slice(0, sep).trim().toLowerCase();
        const value = clean.slice(sep + 1).trim();
        if (key && value) acc[key] = value;
      }
      return acc;
    }, {});
}

export function readGigApplicationMode(requirements?: string[] | null, fallback: GigApplicationMode = "apply"): GigApplicationMode {
  const raw = String(parseGigRequirementMeta(requirements).application_mode ?? "")
    .trim()
    .toLowerCase();

  if (
    raw === "proposal" ||
    raw === "proposal_required" ||
    raw === "proposal-required" ||
    raw === "requires_proposal" ||
    raw === "requires-proposal"
  ) {
    return "proposal";
  }

  if (
    raw === "apply" ||
    raw === "application" ||
    raw === "simple_apply" ||
    raw === "simple-apply" ||
    raw === "direct_apply" ||
    raw === "direct-apply"
  ) {
    return "apply";
  }

  return fallback;
}

export function resolveGigApplicationMode(
  input?: { requirements?: string[] | null; applicationMode?: string | null },
  fallback: GigApplicationMode = "apply"
): GigApplicationMode {
  const meta = parseGigRequirementMeta(input?.requirements);
  if (Object.prototype.hasOwnProperty.call(meta, "application_mode")) {
    return readGigApplicationMode(input?.requirements, fallback);
  }

  const explicit = String(input?.applicationMode ?? "")
    .trim()
    .toLowerCase();
  if (explicit === "apply" || explicit === "proposal") return explicit;
  return fallback;
}
