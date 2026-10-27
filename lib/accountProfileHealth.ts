/** A missing profile is reversible: the account row, reels and earnings are retained. */
export type AccountProfileHealth = {
  status: "healthy" | "suspected" | "missing";
  checkedAt?: string;
  firstMissingAt?: string;
  missingChecks: number;
  removedAt?: string;
  verifyCode?: string;
  recovery?: {
    handle: string;
    profileUrl: string;
    submittedAt: string;
    manualReview: boolean;
    message: string;
    blocked?: boolean;
  };
};

export const PROFILE_MISSING_CONFIRM_MS = 5 * 60_000;
export const PROFILE_RECOVERY_COOLDOWN_MS = 60_000;

/** Allowlist persisted/API metadata; never copy arbitrary JSON into browser caches. */
export function readProfileHealth(raw: unknown): AccountProfileHealth | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const v = raw as Record<string, unknown>;
  if (!["healthy", "suspected", "missing"].includes(String(v.status))) return undefined;
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
  const r = v.recovery && typeof v.recovery === "object" ? v.recovery as Record<string, unknown> : null;
  return {
    status: v.status as AccountProfileHealth["status"],
    checkedAt: date(v.checkedAt), firstMissingAt: date(v.firstMissingAt), removedAt: date(v.removedAt),
    missingChecks: Math.max(0, Math.min(100, Math.trunc(Number(v.missingChecks) || 0))),
    ...(typeof v.verifyCode === "string" && /^RL-[A-Z0-9]{6}$/.test(v.verifyCode) ? { verifyCode: v.verifyCode } : {}),
    ...(r && typeof r.handle === "string" && typeof r.profileUrl === "string" && date(r.submittedAt) ? { recovery: {
      handle: r.handle.slice(0, 120), profileUrl: r.profileUrl.slice(0, 300), submittedAt: date(r.submittedAt)!,
      manualReview: r.manualReview === true, message: typeof r.message === "string" ? r.message.slice(0, 300) : "",
      ...(r.blocked === true ? { blocked: true } : {}),
    } } : {}),
  };
}

/** Only explicit profile-level absence calls this; access errors never advance the counter. */
export function recordMissingProfile(previous: unknown, now = Date.now()): AccountProfileHealth {
  const before = readProfileHealth(previous);
  const first = before?.status === "suspected" ? Date.parse(before.firstMissingAt ?? "") : NaN;
  const firstMissingAt = Number.isFinite(first) ? first : now;
  const confirmed = Number.isFinite(first) && now - first >= PROFILE_MISSING_CONFIRM_MS;
  return {
    status: confirmed ? "missing" : "suspected", checkedAt: new Date(now).toISOString(),
    firstMissingAt: new Date(firstMissingAt).toISOString(), missingChecks: confirmed ? Math.max(2, (before?.missingChecks ?? 1) + 1) : 1,
    ...(confirmed ? { removedAt: new Date(now).toISOString() } : {}),
  };
}

export const needsProfileRecovery = (account: { status: string; profileHealth?: AccountProfileHealth }) => account.status === "unlinked" && account.profileHealth?.status === "missing";
