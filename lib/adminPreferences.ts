export const ADMIN_PREFERENCES_COOKIE = "reelencer_admin_view";
export const LINKED_ACCOUNT_FILTERS = ["all", "attention", "due", "reels", "active", "paused", "unlinked"] as const;
export type LinkedAccountFilter = typeof LINKED_ACCOUNT_FILTERS[number];

/** Only a small, non-sensitive UI preference belongs in this cookie. */
export function readAdminFilter(cookie?: string): LinkedAccountFilter {
  try {
    const input = cookie ?? (typeof document === "undefined" ? "" : document.cookie);
    const value = input.split(";").map(part => part.trim()).find(part => part.startsWith(`${ADMIN_PREFERENCES_COOKIE}=`))?.slice(ADMIN_PREFERENCES_COOKIE.length + 1);
    const parsed = value && JSON.parse(decodeURIComponent(value));
    if (parsed?.v === 1 && LINKED_ACCOUNT_FILTERS.includes(parsed.linkedFilter)) return parsed.linkedFilter;
  } catch { /* Ignore old or malformed preferences. */ }
  return "all";
}

export function saveAdminFilter(filter: LinkedAccountFilter) {
  if (typeof document === "undefined" || !LINKED_ACCOUNT_FILTERS.includes(filter)) return;
  const value = encodeURIComponent(JSON.stringify({ v: 1, linkedFilter: filter }));
  try { document.cookie = `${ADMIN_PREFERENCES_COOKIE}=${value}; Path=/admin; Max-Age=2592000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* Preferences are optional when cookies are blocked. */ }
}

export function clearAdminPreferences() {
  try { if (typeof document !== "undefined") document.cookie = `${ADMIN_PREFERENCES_COOKIE}=; Path=/admin; Max-Age=0; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* No cookie is required for authorization or caching. */ }
}
