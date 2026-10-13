import "server-only";
import { createHash, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { addressOf, resendKey, resolveProvider, resolveSender, supportAddress, type EmailCategory, type EmailProvider } from "./config";

type Transporter = ReturnType<typeof nodemailer.createTransport>;

// The one mailer every Reelencer email goes through (account, applications, KYC).
// Resend is the primary provider, sending from the verified business domain (MAIL_FROM, default hello@reelencer.com).
// Mailgun and SMTP remain for local development or as an opt-in fallback (MAIL_SMTP_FALLBACK=true).
// Bounces and spam complaints reported by Resend's webhook (app/api/webhooks/resend) are suppressed here.

export type { EmailCategory, EmailProvider };
export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  category?: EmailCategory;
  /** Same key → Resend sends at most once (24h), even across retries or a double-clicked action. */
  idempotencyKey?: string;
};
export type SendResult = { provider: EmailProvider; id?: string };

const env = (...keys: string[]) => keys.map((key) => String(process.env[key] ?? "").trim()).find(Boolean) ?? "";

/** Public site origin for links inside emails (no trailing slash). */
export function emailBaseUrl() {
  return (env("NEXT_PUBLIC_SITE_URL", "APP_URL", "NEXT_PUBLIC_APP_URL") || "https://reelencer.com").replace(/\/+$/, "");
}

const replyTo = () => env("MAIL_REPLY_TO") || supportAddress();

export class MailConfigError extends Error {}
class MailSuppressedError extends Error {}

/** Resend/Mailgun HTTP failure, keeping the status (and Retry-After) for retry decisions. */
function httpError(provider: string, status: number, body: string, retryAfter: string | null) {
  let message = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { message?: string; name?: string };
    if (parsed.message) message = `${provider}: ${parsed.message}`;
  } catch {
    // keep the raw text
  }
  return Object.assign(new Error(message || `${provider} delivery failed with status ${status}.`), {
    status,
    retryAfterMs: retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : undefined,
  });
}

let smtp: { key: string; transporter: Transporter; user: string } | null = null;
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
      user,
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
  return smtp;
}

async function viaResend(mail: Required<Pick<OutgoingEmail, "idempotencyKey">> & OutgoingEmail): Promise<SendResult> {
  const sender = resolveSender("resend");
  if (sender.problem) throw new MailConfigError(sender.problem);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${resendKey()}`,
      "Content-Type": "application/json",
      "Idempotency-Key": mail.idempotencyKey,
      "User-Agent": "reelencer-mailer/1",
    },
    body: JSON.stringify({
      from: sender.from,
      to: [mail.to],
      reply_to: replyTo(),
      subject: mail.subject,
      html: mail.html,
      ...(mail.text ? { text: mail.text } : {}),
      // A unique ref per message stops Gmail from collapsing similar notifications into one thread.
      headers: { "X-Entity-Ref-ID": randomUUID() },
      tags: [{ name: "category", value: mail.category ?? "system" }],
    }),
  });
  const body = await response.text().catch(() => "");
  if (!response.ok) throw httpError("Resend", response.status, body, response.headers.get("retry-after"));
  let id: string | undefined;
  try {
    id = (JSON.parse(body) as { id?: string }).id;
  } catch {
    // id is informational only
  }
  return { provider: "resend", id };
}

async function viaMailgun(mail: OutgoingEmail): Promise<SendResult> {
  const sender = resolveSender("mailgun");
  if (sender.problem) throw new MailConfigError(sender.problem);
  const params = new URLSearchParams({ from: sender.from, to: mail.to, subject: mail.subject, html: mail.html, "h:Reply-To": replyTo() });
  if (mail.text) params.set("text", mail.text);
  params.set("h:X-Entity-Ref-ID", randomUUID());
  params.set("o:tag", mail.category ?? "system");
  const base = (env("MAILGUN_API_BASE") || "https://api.mailgun.net").replace(/\/+$/, "");
  const response = await fetch(`${base}/v3/${env("MAILGUN_DOMAIN")}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Basic ${Buffer.from(`api:${env("MAILGUN_API_KEY")}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!response.ok) throw httpError("Mailgun", response.status, await response.text().catch(() => ""), response.headers.get("retry-after"));
  return { provider: "mailgun" };
}

async function viaSmtp(mail: OutgoingEmail): Promise<SendResult> {
  const transport = smtpTransport();
  if (!transport) throw new MailConfigError("SMTP isn't configured.");
  const sender = resolveSender("smtp", process.env, transport.user);
  await transport.transporter.sendMail({
    from: sender.from,
    to: mail.to,
    replyTo: replyTo(),
    subject: mail.subject,
    html: mail.html,
    ...(mail.text ? { text: mail.text } : {}),
    headers: { "X-Entity-Ref-ID": randomUUID() },
  });
  return { provider: "smtp" };
}

const SEND = { resend: viaResend, mailgun: viaMailgun, smtp: viaSmtp } as const;

/** Network blips, SMTP 4xx "try again later", and provider 429/5xx are worth another attempt; bad auth/addresses aren't. */
function isTransient(error: unknown) {
  if (error instanceof MailConfigError || error instanceof MailSuppressedError) return false;
  const e = error as { code?: string; responseCode?: number; status?: number };
  if (["ETIMEDOUT", "ECONNRESET", "ECONNECTION", "ESOCKET", "EDNS", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"].includes(e?.code ?? "")) return true;
  if (e?.responseCode && e.responseCode >= 421 && e.responseCode < 500) return true;
  if (e?.status && (e.status === 429 || e.status >= 500)) return true;
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /fetch failed/i.test(error.message));
}

/**
 * The provider account rather than this message is at fault: missing/invalid API key, unverified sending domain, or a
 * sender our own config rejects. Worth the SMTP fallback; a bad recipient address (422) is not.
 */
function isProviderSetupError(error: unknown) {
  if (error instanceof MailConfigError) return true;
  const e = error as { status?: number; message?: string };
  if (e?.status === 401 || e?.status === 403) return true;
  return e?.status === 400 && /api key|domain/i.test(e.message ?? "");
}

/**
 * Addresses Resend reported as hard-bounced or that marked us as spam (email_suppressions). Account emails the
 * person asked for (sign-up, password reset) still go to complainers; nothing goes to an address that hard-bounced.
 */
async function suppression(address: string, category: EmailCategory) {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  try {
    // Plain REST read: one small request, independent of the realtime client (and of the Node version).
    const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/email_suppressions?select=reason&email=eq.${encodeURIComponent(address)}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const reason = ((await response.json()) as { reason?: string }[])[0]?.reason;
    if (!reason || (reason === "complained" && category === "account")) return null;
    return reason;
  } catch {
    // Never block mail on the suppression lookup (e.g. before the migration is applied).
    return null;
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one email. Retries transient failures (up to 3 attempts, honouring Retry-After) with the same idempotency key,
 * so a retry can never produce a duplicate. With MAIL_SMTP_FALLBACK=true, a Resend outage falls back to SMTP.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<SendResult> {
  const provider = resolveProvider();
  if (!provider) throw new MailConfigError("Email delivery is not configured. Set RESEND_API_KEY and MAIL_FROM (an address on your verified domain).");
  const to = addressOf(mail.to);
  const category = mail.category ?? "system";
  const reason = await suppression(to, category);
  if (reason) throw new MailSuppressedError(`Not sent: ${to} is suppressed (${reason === "complained" ? "marked an earlier email as spam" : "the address bounced"}).`);

  const message = {
    ...mail,
    to,
    category,
    idempotencyKey: mail.idempotencyKey ?? `${category}:${createHash("sha256").update(`${to}\n${mail.subject}\n${randomUUID()}`).digest("hex").slice(0, 40)}`,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await SEND[provider](message);
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === 3) break;
      if (provider === "smtp") {
        smtp?.transporter.close();
        smtp = null;
      }
      const retryAfter = (error as { retryAfterMs?: number }).retryAfterMs;
      await pause(Math.min(retryAfter ?? 600 * 2 ** (attempt - 1), 5_000));
    }
  }

  if (provider !== "smtp" && (isTransient(lastError) || isProviderSetupError(lastError)) && env("MAIL_SMTP_FALLBACK").toLowerCase() === "true" && smtpTransport()) {
    const why = lastError instanceof Error ? lastError.message.slice(0, 160) : "unavailable";
    console.warn(`[mail] ${provider} failed (${why}); sending "${category}" email through SMTP fallback`);
    return viaSmtp(message);
  }
  throw lastError;
}
