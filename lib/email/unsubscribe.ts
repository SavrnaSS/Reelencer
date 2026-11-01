import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { emailBaseUrl } from "./send";

// Signed one-click unsubscribe links for promotional email: the token is an HMAC of the address, so a link can only
// unsubscribe the address it was sent to.

function secret() {
  return [process.env.EMAIL_LINK_SECRET, process.env.CRON_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY].map(value => String(value ?? "").trim()).find(value => value.length >= 16) ?? "";
}

const sign = (email: string, key: string) => createHmac("sha256", key).update(`unsubscribe:${email.trim().toLowerCase()}`).digest("base64url").slice(0, 32);

/** The unsubscribe link for an address, or null when no signing secret is configured. */
export function unsubscribeUrl(email: string) {
  const key = secret();
  if (!key) return null;
  const address = email.trim().toLowerCase();
  const params = new URLSearchParams({ e: Buffer.from(address).toString("base64url"), t: sign(address, key) });
  return `${emailBaseUrl()}/api/email/unsubscribe?${params.toString()}`;
}

/** The address a link unsubscribes, when its token is valid. */
export function verifyUnsubscribe(encoded: string | null, token: string | null): string | null {
  const key = secret();
  if (!key || !encoded || !token) return null;
  let address = "";
  try { address = Buffer.from(encoded, "base64url").toString("utf8").trim().toLowerCase(); } catch { return null; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) return null;
  const expected = Buffer.from(sign(address, key));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected) ? address : null;
}
