import "server-only";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

type Transporter = ReturnType<typeof nodemailer.createTransport>;

// The one mailer every Reelencer email goes through (account, applications, KYC).
// Provider order: Resend → Mailgun → SMTP (Gmail app passwords work). Configure with env vars only.

export type EmailProvider = "resend" | "mailgun" | "smtp";
export type OutgoingEmail = { to: string; subject: string; html: string; text?: string };

const env = (...keys: string[]) => keys.map((key) => String(process.env[key] ?? "").trim()).find(Boolean) ?? "";

const SUPPORT_ADDRESS = "support@reelencer.com";

/** Public site origin for links inside emails (no trailing slash). */
export function emailBaseUrl() {
  return (env("NEXT_PUBLIC_SITE_URL", "APP_URL", "NEXT_PUBLIC_APP_URL") || "https://reelencer.com").replace(/\/+$/, "");
}

/** Extracts the bare address from `Name <addr>` or `addr`. */
function addressOf(value: string) {
  return (/<([^>]+)>/.exec(value)?.[1] ?? value).trim();
}

/**
 * Sender shown in inboxes. Always branded "Reelencer" (MAIL_FROM_NAME overrides), using the configured address,
 * since providers only accept addresses you've verified (Gmail SMTP: the account itself or a "Send mail as" alias).
 */
function fromHeader(fallbackAddress: string) {
  const name = env("MAIL_FROM_NAME") || "Reelencer";
  const address = addressOf(env("MAIL_FROM", "RESEND_FROM", "RESEND_FROM_EMAIL", "MAILGUN_FROM", "SMTP_FROM") || fallbackAddress);
  return `${name} <${address}>`;
}

const replyTo = () => env("MAIL_REPLY_TO") || SUPPORT_ADDRESS;

// A unique ref per message stops Gmail from collapsing similar notifications into one thread.
const entityHeaders = () => ({ "X-Entity-Ref-ID": randomUUID() });

let smtp: { key: string; transporter: Transporter } | null = null;
function smtpTransport() {
  const gmailUser = env("GMAIL_IMAP_USER");
  const gmailPass = env("GMAIL_IMAP_APP_PASSWORD");
  const host = env("SMTP_HOST") || (gmailUser && gmailPass ? "smtp.gmail.com" : "");
  const port = Number(env("SMTP_PORT") || 587);
  const user = env("SMTP_USER") || gmailUser;
  // Google shows app passwords as "abcd efgh ijkl mnop"; the spaces aren't part of the password.
  const pass = (env("SMTP_PASS") || gmailPass).replace(/\s+/g, "");
  if (!host || !user || !pass) return null;
  const key = `${host}:${port}:${user}:${pass.length}`;
  if (smtp?.key !== key) {
    smtp = {
      key,
      // Pooled so bulk actions (automation runs, batch decisions) reuse one authenticated connection.
      transporter: nodemailer.createTransport({
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        disableFileAccess: true,
        disableUrlAccess: true,
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      }),
    };
  }
  return { transporter: smtp.transporter, user };
}

async function sendOnce(mail: OutgoingEmail): Promise<{ provider: EmailProvider }> {
  const resendKey = env("RESEND_API_KEY", "RESEND_KEY", "RESEND_API_TOKEN", "RESEND_TOKEN", "RESEND_SECRET", "RESEND_PRIVATE_KEY", "RESEND_EMAIL_API_KEY");
  if (resendKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromHeader(SUPPORT_ADDRESS),
        to: [mail.to],
        reply_to: replyTo(),
        subject: mail.subject,
        html: mail.html,
        ...(mail.text ? { text: mail.text } : {}),
        headers: entityHeaders(),
      }),
    });
    if (!response.ok) throw httpError("Resend", response.status, await response.text().catch(() => ""));
    return { provider: "resend" };
  }

  const mailgunKey = env("MAILGUN_API_KEY");
  const mailgunDomain = env("MAILGUN_DOMAIN");
  if (mailgunKey && mailgunDomain) {
    const params = new URLSearchParams({ from: fromHeader(SUPPORT_ADDRESS), to: mail.to, subject: mail.subject, html: mail.html, "h:Reply-To": replyTo() });
    if (mail.text) params.set("text", mail.text);
    for (const [name, value] of Object.entries(entityHeaders())) params.set(`h:${name}`, value);
    const base = (env("MAILGUN_API_BASE") || "https://api.mailgun.net").replace(/\/+$/, "");
    const response = await fetch(`${base}/v3/${mailgunDomain}/messages`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Basic ${Buffer.from(`api:${mailgunKey}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!response.ok) throw httpError("Mailgun", response.status, await response.text().catch(() => ""));
    return { provider: "mailgun" };
  }

  const transport = smtpTransport();
  if (!transport) throw new Error("Email delivery is not configured. Set RESEND_API_KEY, MAILGUN_API_KEY + MAILGUN_DOMAIN, or SMTP_HOST/SMTP_USER/SMTP_PASS.");
  await transport.transporter.sendMail({
    from: fromHeader(transport.user),
    to: mail.to,
    replyTo: replyTo(),
    subject: mail.subject,
    html: mail.html,
    ...(mail.text ? { text: mail.text } : {}),
    headers: entityHeaders(),
  });
  return { provider: "smtp" };
}

function httpError(provider: string, status: number, body: string) {
  return Object.assign(new Error(body.slice(0, 300) || `${provider} delivery failed with status ${status}.`), { status });
}

/** Network blips, SMTP 4xx "try again later", and provider 429/5xx are worth one more attempt; bad auth/addresses aren't. */
function isTransient(error: unknown) {
  const e = error as { code?: string; responseCode?: number; status?: number };
  if (["ETIMEDOUT", "ECONNRESET", "ECONNECTION", "ESOCKET", "EDNS", "ECONNREFUSED"].includes(e?.code ?? "")) return true;
  if (e?.responseCode && e.responseCode >= 421 && e.responseCode < 500) return true;
  if (e?.status && (e.status === 429 || e.status >= 500)) return true;
  return error instanceof Error && error.name === "TimeoutError";
}

/** Sends one email, retrying once (after a short pause, on a fresh SMTP connection) when the failure is transient. */
export async function sendEmail(mail: OutgoingEmail): Promise<{ provider: EmailProvider }> {
  try {
    return await sendOnce(mail);
  } catch (error) {
    if (!isTransient(error)) throw error;
    smtp?.transporter.close();
    smtp = null;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return sendOnce(mail);
  }
}
