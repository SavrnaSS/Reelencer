import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ApiError, databaseError } from "./errors";
import { trustedClientIp } from "./clientIp";
import { mutationRateLimit } from "./rateLimit";
import { sendDecisionEmail } from "./gigApplications";
import { firstName, renderBrandEmail } from "@/lib/email/brandEmail";
import { AUTH_LINK_TTL } from "@/lib/authLinkTtl";
import { authEmailLink } from "@/lib/authEmailLinks";

// Sign-up confirmation is sent by the app's own mailer (Resend/Mailgun/SMTP, same as other notifications)
// instead of Supabase's built-in sender, which only delivers to project members and is heavily rate limited.
// Supabase still owns the account and the one-time token: generateLink() returns it without emailing anything.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

export function normalizeEmail(raw: unknown) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new ApiError(400, "Enter a valid email address.", "invalid_email");
  return email;
}

/** Throttles mail per address (shared across instances in production), so the form can't be used to spam an inbox. */
export async function limitAuthMail(email: string, route: string) {
  const key = `auth-mail:${createHash("sha256").update(email).digest("hex")}`;
  await mutationRateLimit(key, route, 3);
}

/**
 * Origin for links in account emails. In development the request's own origin is always right (a configured
 * NEXT_PUBLIC_SITE_URL is easily a stale port); in production the configured public URL wins.
 */
function siteUrl(req: NextRequest) {
  const origin = new URL(req.url).origin;
  if (process.env.NODE_ENV !== "production") return origin;
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  return (configured || origin).replace(/\/+$/, "");
}

function confirmLink(site: string, tokenHash: string, type: string) {
  return authEmailLink(site, tokenHash, type as "signup" | "magiclink" | "recovery");
}

/** Development only: when mail can't be sent, print the link so sign-up can still be finished locally. */
function logLinkForDev(to: string, link: string) {
  if (process.env.NODE_ENV === "production") return;
  console.info(`\n[dev] Email link for ${to} (mail delivery failed):\n${link}\n`);
}

async function sendConfirmEmail(to: string, name: string, link: string, site: string) {
  const first = firstName(name);
  const { html, text } = renderBrandEmail({
    siteUrl: site,
    preheader: `Confirm your email to activate your Reelencer account. The link expires in ${AUTH_LINK_TTL}.`,
    eyebrow: "Confirm your email",
    tone: "success",
    illustration: "welcome",
    title: "One click and you're in",
    greeting: first ? `Hi ${first},` : "Hi there,",
    intro: `Confirm ${to} to activate your Reelencer account and start picking up paid brand gigs.`,
    cta: { label: "Confirm my email", href: link },
    ctaNote: `Expires in ${AUTH_LINK_TTL}`,
    steps: [
      { title: "Pick a brand gig", body: "Briefs come with the deliverables, deadline and payout listed up front." },
      { title: "Make and submit your reel", body: "Upload it in one place and follow the review as it happens." },
      { title: "Get paid to your bank", body: "Withdraw your earnings once the reel is approved." },
    ],
    fallbackLink: link,
    note: "Didn't sign up? You can safely ignore this email; nothing is activated until this link is clicked.",
  });
  try {
    await sendDecisionEmail(to, "Confirm your Reelencer email", html, text, "account");
  } catch (error) {
    logLinkForDev(to, link);
    throw error;
  }
}

/** One-click password reset link for an existing account (null if the address has no account). */
async function recoveryLink(email: string, site: string) {
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token) return null;
  return { link: confirmLink(site, data.properties.hashed_token, "recovery"), name: String(data.user?.user_metadata?.name ?? data.user?.user_metadata?.full_name ?? "") };
}

async function sendExistingAccountEmail(to: string, site: string, tokenHash: string, name: string) {
  const link = authEmailLink(site, tokenHash, "magiclink", "signin");
  // Magic links and recovery links share a Supabase token slot. Both buttons use this one token;
  // generating a separate reset token here would invalidate the sign-in button before delivery.
  const resetLink = authEmailLink(site, tokenHash, "magiclink", "reset");
  const first = firstName(name);
  const { html, text } = renderBrandEmail({
    siteUrl: site,
    preheader: `Your account is ready. Sign in securely without a password. This link expires in ${AUTH_LINK_TTL}.`,
    eyebrow: "Account already active",
    illustration: "welcome",
    title: "You already have an account",
    greeting: first ? `Hi ${first},` : "Hi there,",
    intro: `Someone (hopefully you) tried to sign up with ${to}, which already has an active Reelencer account. Click below to sign in securely and open your account. You won't need to enter your password.`,
    cta: { label: "Log in to my account", href: link },
    ctaNote: `Secure, single-use link · Expires in ${AUTH_LINK_TTL}`,
    secondaryCta: { label: "Reset my password", href: resetLink },
    fallbackLink: link,
    note: "Didn't try to sign up? You can ignore this email. Your password hasn't changed. Keep this email private: either button verifies access to your account, and the link can only be used once.",
  });
  await sendDecisionEmail(to, "You already have a Reelencer account", html, text, "account");
}

const isAlreadyRegistered = (error: { code?: string; status?: number; message?: string }) =>
  error.code === "email_exists" || error.code === "user_already_exists" || /already (been )?registered/i.test(error.message ?? "");

/**
 * For an address that already has an account: a fresh confirmation link if it's still unconfirmed,
 * otherwise a "you already have an account" note. Does nothing for unknown addresses.
 */
export async function remindExistingAccount(req: NextRequest, email: string) {
  const site = siteUrl(req);
  // generateLink(magiclink) can create unknown users. Recovery only finds existing accounts,
  // so check first, and issue the magic link last so it remains the current token.
  const existing = await supabaseAdmin().auth.admin.generateLink({ type: "recovery", email });
  if (existing.error?.code === "user_not_found" || existing.error?.status === 404) return;
  if (existing.error || !existing.data?.user) throw new ApiError(503, "We couldn't prepare your sign-in email. Please try again shortly.", "auth_link_failed");
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.user || !data.properties?.hashed_token) throw new ApiError(503, "We couldn't prepare your sign-in email. Please try again shortly.", "auth_link_failed");
  if (data.user.email_confirmed_at) {
    const name = String(data.user.user_metadata?.name ?? data.user.user_metadata?.full_name ?? "");
    await sendExistingAccountEmail(email, site, data.properties.hashed_token, name);
    return;
  }
  // Verifying a magic link also confirms the address, so it doubles as a fresh confirmation link.
  const name = String(data.user.user_metadata?.name ?? data.user.user_metadata?.full_name ?? "");
  await sendConfirmEmail(email, name, confirmLink(site, data.properties.hashed_token, "magiclink"), site);
}

export async function startSignup(req: NextRequest, input: { email: string; password: string; name: string }) {
  if (input.password.length < MIN_PASSWORD) throw new ApiError(400, `Use at least ${MIN_PASSWORD} characters for your password.`, "weak_password");
  if (input.password.length > 72) throw new ApiError(400, "Use 72 characters or fewer for your password.", "weak_password");

  const ip = trustedClientIp(req);
  if (ip) {
    const blocked = await supabaseAdmin().from("worker_ip_blocks").select("user_id").eq("ip", ip).limit(1);
    databaseError(blocked.error);
    if (blocked.data?.length) throw new ApiError(403, "Sign-ups from this IP address are suspended. Contact support.", "ip_blocked");
  }

  const { data, error } = await supabaseAdmin().auth.admin.generateLink({
    type: "signup",
    email: input.email,
    password: input.password,
    options: { data: { name: input.name, full_name: input.name } },
  });

  if (error) {
    if (isAlreadyRegistered(error)) return remindExistingAccount(req, input.email);
    if (error.code === "weak_password") throw new ApiError(400, error.message || "Choose a stronger password.", "weak_password");
    if (error.code === "signup_disabled") throw new ApiError(403, "New sign-ups are paused right now.", "signup_disabled");
    throw new ApiError(503, "We couldn't create your account right now. Please try again.", "signup_failed");
  }

  const site = siteUrl(req);
  await sendConfirmEmail(input.email, input.name, confirmLink(site, data.properties.hashed_token, "signup"), site);
}

/**
 * Password reset through the app's mailer and template (Supabase's built-in sender only reaches project members).
 * Silent for unknown addresses so the form can't be used to discover accounts.
 */
export async function sendPasswordReset(req: NextRequest, email: string) {
  const site = siteUrl(req);
  const reset = await recoveryLink(email, site);
  if (!reset) return;
  const first = firstName(reset.name);
  const { html, text } = renderBrandEmail({
    siteUrl: site,
    preheader: `Use this link to choose a new Reelencer password. It expires in ${AUTH_LINK_TTL} and works once.`,
    eyebrow: "Password reset",
    tone: "neutral",
    illustration: "security",
    title: "Choose a new password",
    greeting: first ? `Hi ${first},` : "Hi there,",
    intro: `We got a request to reset the password for ${email}. Click below to choose a new one; your current password keeps working until you do.`,
    cta: { label: "Choose a new password", href: reset.link },
    ctaNote: `Expires in ${AUTH_LINK_TTL}`,
    fallbackLink: reset.link,
    note: "Didn't ask for this? You can ignore this email; your password won't change. If you keep getting these, reply and we'll take a look.",
  });
  try {
    await sendDecisionEmail(email, "Reset your Reelencer password", html, text, "account");
  } catch (error) {
    logLinkForDev(email, reset.link);
    throw error;
  }
}

/** Wraps mailer failures in a clear, retryable message (the account itself is already safe to retry). */
export async function withMailErrors(task: () => Promise<void>) {
  try {
    await task();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Provider codes/messages (e.g. EAUTH "535 Username and Password not accepted") are what make this debuggable;
    // they never contain credentials.
    const e = error as { name?: string; code?: string; responseCode?: number; command?: string; message?: string };
    console.error(JSON.stringify({ event: "auth_mail_failed", type: e?.name ?? "UnknownError", code: e?.code, responseCode: e?.responseCode, command: e?.command, message: String(e?.message ?? "").slice(0, 300) }));
    throw new ApiError(502, "We couldn't send the email just now. Please try again in a minute.", "mail_failed");
  }
}
