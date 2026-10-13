import { createHmac, timingSafeEqual } from "node:crypto";

// Pure mail configuration helpers (no I/O), shared by the mailer, the Resend webhook, scripts and tests.

export type EmailProvider = "resend" | "mailgun" | "smtp";
/** What an email is about. Sent to Resend as a tag (filterable in its dashboard) and used for suppression rules. */
export type EmailCategory = "account" | "applications" | "kyc" | "payouts" | "system";

type Env = Record<string, string | undefined>;
const read = (env: Env, ...keys: string[]) => keys.map((key) => String(env[key] ?? "").trim()).find(Boolean) ?? "";

/** The business domain mail is sent from. Must be verified in Resend (Domains → Add domain). */
export const mailDomain = (env: Env = process.env) => read(env, "MAIL_DOMAIN").toLowerCase() || "reelencer.com";

export const supportAddress = (env: Env = process.env) => read(env, "MAIL_SUPPORT_ADDRESS") || `support@${mailDomain(env)}`;

/** Extracts the bare address from `Name <addr>` or `addr`. */
export function addressOf(value: string) {
  return (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase();
}

export const domainOf = (address: string) => addressOf(address).split("@")[1] ?? "";

// Consumer mailboxes can't be verified as a sending domain, and providers reject or spam-folder mail "from" them.
const FREE_MAILBOX = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|aol|proton|protonmail|rediffmail|zoho)\.[a-z.]+$/;
export const isFreeMailbox = (address: string) => FREE_MAILBOX.test(domainOf(address));

/** Which provider sends: MAIL_PROVIDER when set, otherwise the first one configured (Resend → Mailgun → SMTP). */
export function resolveProvider(env: Env = process.env): EmailProvider | null {
  const explicit = read(env, "MAIL_PROVIDER").toLowerCase();
  const configured = {
    resend: !!resendKey(env),
    mailgun: !!(read(env, "MAILGUN_API_KEY") && read(env, "MAILGUN_DOMAIN")),
    smtp: !!((read(env, "SMTP_HOST") || read(env, "GMAIL_IMAP_USER")) && (read(env, "SMTP_PASS") || read(env, "GMAIL_IMAP_APP_PASSWORD"))),
  };
  if (explicit === "resend" || explicit === "mailgun" || explicit === "smtp") return configured[explicit] ? explicit : null;
  return configured.resend ? "resend" : configured.mailgun ? "mailgun" : configured.smtp ? "smtp" : null;
}

export const resendKey = (env: Env = process.env) =>
  read(env, "RESEND_API_KEY", "RESEND_KEY", "RESEND_API_TOKEN", "RESEND_TOKEN", "RESEND_SECRET", "RESEND_PRIVATE_KEY", "RESEND_EMAIL_API_KEY");

/**
 * The From header. Always shown as "Reelencer" (MAIL_FROM_NAME overrides). For Resend and Mailgun the address must be
 * on the verified business domain, so a Gmail SMTP_FROM is never reused there; SMTP keeps its own account address.
 */
export function resolveSender(provider: EmailProvider, env: Env = process.env, smtpUser = ""): { from: string; address: string; problem?: string } {
  const name = read(env, "MAIL_FROM_NAME") || (/^([^<]+)</.exec(read(env, "MAIL_FROM"))?.[1]?.trim() ?? "") || "Reelencer";
  const configured =
    provider === "resend"
      ? read(env, "MAIL_FROM", "RESEND_FROM", "RESEND_FROM_EMAIL")
      : provider === "mailgun"
        ? read(env, "MAIL_FROM", "MAILGUN_FROM")
        : read(env, "SMTP_FROM", "MAIL_FROM") || smtpUser;
  const address = addressOf(configured || (provider === "smtp" ? smtpUser : `hello@${mailDomain(env)}`));
  let problem: string | undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) problem = `The sender address "${address}" isn't a valid email address.`;
  else if (provider !== "smtp" && isFreeMailbox(address))
    problem = `${provider === "resend" ? "Resend" : "Mailgun"} can't send from ${domainOf(address)}. Set MAIL_FROM to an address on your verified business domain, e.g. "Reelencer <hello@${mailDomain(env)}>".`;
  return { from: `${name.replace(/[<>"]/g, "")} <${address}>`, address, problem };
}

/**
 * Verifies a Resend webhook (Svix signing): HMAC-SHA256 over `${id}.${timestamp}.${body}` with the base64 secret after
 * "whsec_", compared against every "v1,<sig>" in the header, and rejects timestamps more than 5 minutes off.
 */
export function verifyWebhookSignature(
  { id, timestamp, signature, body }: { id: string | null; timestamp: string | null; signature: string | null; body: string },
  secret: string,
  nowMs = Date.now()
) {
  if (!id || !timestamp || !signature || !secret) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(nowMs / 1000 - seconds) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(/\s+/).some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
