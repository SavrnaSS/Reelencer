import type { EmailOtpType } from "@supabase/supabase-js";

export type AuthEmailIntent = "confirm" | "signin" | "reset";

const OTP_TYPES: readonly string[] = ["signup", "magiclink", "email", "invite", "email_change", "recovery"];
const BASE = "https://auth.reelencer.invalid";

export function authEmailIntent(raw: string | null, type: string | null): AuthEmailIntent {
  if (type === "recovery" || raw === "reset") return "reset";
  return raw === "signin" ? "signin" : "confirm";
}

/** Reject browser-normalized external URLs, including backslashes and control characters. */
export function safeAuthEmailNext(raw: string | null, fallback = "/post-login") {
  if (!raw?.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, BASE);
    return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

/** Keep the bearer credential in the fragment, which browsers exclude from HTTP requests and referrers. */
export function authEmailLink(site: string, tokenHash: string, type: EmailOtpType, intent: AuthEmailIntent = type === "recovery" ? "reset" : "confirm") {
  const url = new URL("/auth/confirm", site);
  url.searchParams.set("intent", intent);
  url.hash = new URLSearchParams({ token_hash: tokenHash, type }).toString();
  return url.toString();
}

/** Accept older query-string emails too; never combine credentials from two different links. */
export function readAuthEmailLink(href: string) {
  const url = new URL(href, BASE);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const params = fragment.has("token_hash") ? fragment : url.searchParams;
  const rawType = params.get("type");
  const type = rawType && OTP_TYPES.includes(rawType) ? rawType as EmailOtpType : null;
  const intent = authEmailIntent(url.searchParams.get("intent"), type);
  return {
    tokenHash: params.get("token_hash"),
    type,
    intent,
    next: intent === "reset" ? "/reset-password" : safeAuthEmailNext(params.get("next")),
    cleanPath: `/auth/confirm?intent=${intent}`,
  };
}
