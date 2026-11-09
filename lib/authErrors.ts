// Creator-facing copy for sign-in, sign-up and password errors.
// Auth provider and browser messages ("Database error querying schema", "Failed to fetch", provider names) are never
// shown as-is: known cases get written copy and everything else gets the caller's fallback.

export type AuthErrorLike = { message?: unknown; code?: unknown; status?: unknown; name?: unknown } | null | undefined;

export const AUTH_COPY = {
  invalidCredentials: "That email and password don't match. Check them and try again.",
  emailNotConfirmed: "Confirm your email before logging in. We sent a link to your inbox.",
  rateLimited: "Too many attempts. Please wait a minute and try again.",
  suspended: "This account is suspended. Contact support if you think this is a mistake.",
  samePassword: "Choose a password you haven't used for this account before.",
  weakPassword: "Choose a stronger password: at least 6 characters, mixing letters and numbers.",
  sessionExpired: "Your secure link has expired. Request a new one and try again.",
  signupsPaused: "New sign-ups are paused right now. Please try again later.",
  offline: "You seem to be offline. Check your internet connection and try again.",
  unreachable: "We can't reach Reelencer right now. Check your connection and try again in a moment.",
  unavailable: "Sign-in is temporarily unavailable. Please try again in a moment.",
} as const;

function parts(error: unknown) {
  const err = (error && typeof error === "object" ? error : {}) as Exclude<AuthErrorLike, null | undefined>;
  return {
    message: String(err.message ?? "").toLowerCase(),
    code: String(err.code ?? "").toLowerCase(),
    name: String(err.name ?? "").toLowerCase(),
    status: Number(err.status ?? NaN),
  };
}

/** The request never got an answer: offline, DNS, blocked, or the browser fetch threw. */
export function isAuthNetworkFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const { message, code, name, status } = parts(error);
  return (
    code === "supabase_network_error" ||
    status === 0 ||
    status === 520 ||
    name.includes("fetch") ||
    /failed to fetch|fetch failed|load failed|networkerror|network request failed/.test(message)
  );
}

export function friendlyAuthError(error: unknown, fallback: string): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return AUTH_COPY.offline;
  if (!error) return fallback;
  const { message, code, status } = parts(error);

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) return AUTH_COPY.invalidCredentials;
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) return AUTH_COPY.emailNotConfirmed;
  if (code.startsWith("over_") || code === "too_many_requests" || status === 429 || /rate limit|too many/.test(message)) return AUTH_COPY.rateLimited;
  if (code === "user_banned" || message.includes("banned")) return AUTH_COPY.suspended;
  if (code === "same_password" || /different from the old|same password/.test(message)) return AUTH_COPY.samePassword;
  if (code === "weak_password" || message.includes("password should")) return AUTH_COPY.weakPassword;
  if (code === "signup_disabled") return AUTH_COPY.signupsPaused;
  if (/^(session_not_found|session_expired|refresh_token_not_found|otp_expired|flow_state_expired|bad_jwt)$/.test(code) || message.includes("auth session missing")) return AUTH_COPY.sessionExpired;
  if (isAuthNetworkFailure(error)) return AUTH_COPY.unreachable;
  if (status >= 500 || code === "unexpected_failure" || /database error|timeout|timed out|unavailable|unexpected token/.test(message)) return AUTH_COPY.unavailable;
  return fallback;
}
