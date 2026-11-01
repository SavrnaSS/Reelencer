import { renderBrandEmail, firstName } from "./email/brandEmail";
import { CREATOR_HOME_HREF, FIND_GIGS_HREF, findGigHref } from "./routes";

// Bulk email from the admin Workers directory. Four kinds: a Terms of Service reminder (a service notice every
// creator gets), a follow-up about each person's own application or account (one template per quick view in the
// directory), a gig promotion and a general announcement (both promotional: they carry an unsubscribe link and skip
// anyone who opted out). Tokens like {first_name} or {gig_title} are filled in for each recipient (BROADCAST_TOKENS).

export type BroadcastKind = "terms" | "reminder" | "promotion" | "announcement";
export type BroadcastGig = { id: string; title: string; company: string; payout?: string; payoutType?: string; platform?: string };
export type BroadcastContent = {
  kind: BroadcastKind;
  subject: string;
  title: string;
  message: string;
  ctaLabel?: string;
  ctaUrl?: string;
  gig?: BroadcastGig | null;
};
/** Per-recipient values for the tokens, from the application they were picked for. */
export type BroadcastVars = Partial<Record<"gig_title" | "company" | "handle" | "code" | "gig_link", string>>;
export type BroadcastRecipient = { workerId: string; email: string; name: string; vars?: BroadcastVars };

/** Tokens the team can use, with the wording used when a recipient has no value for one. */
export const BROADCAST_TOKENS: Array<{ token: string; label: string; fallback: string }> = [
  { token: "first_name", label: "First name", fallback: "there" },
  { token: "gig_title", label: "Gig", fallback: "your gig" },
  { token: "company", label: "Company", fallback: "the brand" },
  { token: "handle", label: "@handle", fallback: "your account" },
  { token: "code", label: "Bio code", fallback: "your code" },
  { token: "gig_link", label: "Gig link", fallback: "" },
];
/** What the preview fills the tokens with. */
export const SAMPLE_VARS: BroadcastVars = { gig_title: "Record an indoor reaction video", company: "Parakeet Ai", handle: "priya.creates", code: "RL-LG5UGV" };

export const BROADCAST_LIMITS = { subject: 160, title: 120, message: 4000, ctaLabel: 40, recipients: 1000, chunk: 20 };
export const BROADCAST_KIND_LABELS: Record<BroadcastKind, string> = { terms: "Terms reminder", reminder: "Follow-up", promotion: "Promote a gig", announcement: "Announcement" };

/** Promotional email carries an unsubscribe link and skips anyone who opted out. */
export const isPromotional = (kind: BroadcastKind) => kind === "promotion" || kind === "announcement";

/**
 * Follow-up copy for each quick view in the Workers directory (lib/workerActivity ACTIVITY_PRESETS), written for
 * the person's own situation. The button goes to their own gig ({gig_link}), straight to the account setup when
 * that's what needs doing.
 */
const FOLLOW_UPS: Record<string, Omit<BroadcastContent, "kind" | "gig">> = {
  awaiting: {
    subject: "We're checking @{handle} for {gig_title}",
    title: "Your account is with our team",
    message: "Hi {first_name}, thanks for setting up @{handle} for {gig_title} by {company}. Our team is reviewing it now, and you'll get an email as soon as there's a decision.\n\nPlease keep {code} in the bio until your account is verified.",
    ctaLabel: "Track my application", ctaUrl: "{gig_link}",
  },
  no_username: {
    subject: "One step left for {gig_title}",
    title: "Add the account you'll post from",
    message: "Hi {first_name}, you applied to {gig_title} by {company}, but we haven't received your Instagram username yet. It takes about two minutes:\n\n1. Create or choose the account you'll post from. Keep it public.\n2. Paste {code} anywhere in its bio and save.\n3. Enter the username on your gig page. We verify it automatically, no password needed.",
    ctaLabel: "Add my account", ctaUrl: "{gig_link}",
  },
  code: {
    subject: "Add {code} to @{handle}'s bio",
    title: "Your code isn't in the bio yet",
    message: "Hi {first_name}, we checked @{handle} for {gig_title}, but {code} isn't in the bio yet.\n\nPaste it anywhere in the bio and save. We'll spot it on our own and move your application to screening. You can remove it once you're verified.",
    ctaLabel: "Open my setup", ctaUrl: "{gig_link}",
  },
  unreadable: {
    subject: "Keep @{handle} public so we can verify it",
    title: "We couldn't read your bio",
    message: "Hi {first_name}, Instagram didn't let us read @{handle}'s bio for {gig_title}. Please make sure the account is public and {code} is saved in the bio.\n\nWe'll keep checking automatically, and the team will verify it by hand if needed.",
    ctaLabel: "Check my setup", ctaUrl: "{gig_link}",
  },
  changes: {
    subject: "Action needed on your {gig_title} account",
    title: "A quick fix is needed",
    message: "Hi {first_name}, our team asked for a change to the account you sent for {gig_title} by {company}. Open your gig page to see exactly what to update, then send it again. It only takes a minute.",
    ctaLabel: "See what to fix", ctaUrl: "{gig_link}",
  },
  pending: {
    subject: "Your application for {gig_title} is in review",
    title: "We've got your application",
    message: "Hi {first_name}, thanks for applying to {gig_title} by {company}. It's in our review queue, and we'll email you as soon as there's a decision. Make sure everything on your gig page is complete so we can move quickly.",
    ctaLabel: "View my application", ctaUrl: "{gig_link}",
  },
  kyc: {
    subject: "Your KYC is being reviewed",
    title: "Your identity check is in progress",
    message: "Hi {first_name}, we've received your KYC and our team is reviewing it. You'll get an email once it's approved. Until then you can keep working on your gigs as usual.",
    ctaLabel: "Open my wallet", ctaUrl: "/dashboard?section=wallet",
  },
  never: {
    subject: "Your first gig is waiting",
    title: "Find a gig that fits you",
    message: "Hi {first_name}, you haven't applied to a gig yet. Brands on Reelencer pay creators for short-form videos, and applying takes a few taps. Have a look at what's open today.",
    ctaLabel: "Find gigs", ctaUrl: FIND_GIGS_HREF,
  },
  new: {
    subject: "Welcome to Reelencer, {first_name}",
    title: "Great to have you here",
    message: "Hi {first_name}, welcome to Reelencer! Here's how to get started:\n\n1. Complete your profile.\n2. Apply to a gig that fits your style.\n3. Post, get approved and get paid to your wallet.\n\nReply to this email if you need a hand.",
    ctaLabel: "Find my first gig", ctaUrl: FIND_GIGS_HREF,
  },
};

export const hasFollowUp = (presetId: string | null | undefined) => !!presetId && presetId in FOLLOW_UPS;
export function followUpTemplate(presetId: string): BroadcastContent {
  const copy = FOLLOW_UPS[presetId] ?? FOLLOW_UPS.pending;
  return { kind: "reminder", ...copy };
}

/** Starting copy for each kind; the team edits it before sending. */
export function broadcastTemplate(kind: BroadcastKind, gig?: BroadcastGig | null): Omit<BroadcastContent, "gig"> & { gig?: BroadcastGig | null } {
  if (kind === "terms") {
    return {
      kind,
      subject: "A quick reminder about Reelencer's Terms of Service",
      title: "Our Terms, in a minute",
      message:
        "Hi {first_name}, here's a short reminder of what keeps Reelencer fair for every creator:\n\n" +
        "• Post only from accounts you own, and keep them public while you work on a gig.\n" +
        "• Use original content that follows each gig's brief. No bought views, bots or engagement tricks.\n" +
        "• Keep your payout details accurate. Withdrawals over ₹1,000 need a one-time KYC.\n\n" +
        "Breaking these can pause your account or hold payouts. Please take a moment to read the full Terms.",
      ctaLabel: "Read the Terms",
      ctaUrl: "/terms",
    };
  }
  if (kind === "reminder") return followUpTemplate("pending");
  if (kind === "promotion") {
    return {
      kind,
      subject: gig ? `New gig: ${gig.title} by ${gig.company}` : "A new gig is open on Reelencer",
      title: gig ? gig.title : "A new gig is open",
      message: gig
        ? `Hi {first_name}, ${gig.company} just opened a gig on Reelencer and we think it's a great fit for you. Spots fill quickly, so take a look and apply while it's open.`
        : "Hi {first_name}, a new gig just opened on Reelencer. Take a look and apply while spots are open.",
      ctaLabel: "View the gig",
      ctaUrl: gig ? findGigHref(gig.id) : FIND_GIGS_HREF,
      gig: gig ?? null,
    };
  }
  return { kind, subject: "News from Reelencer", title: "What's new on Reelencer", message: "Hi {first_name}, ", ctaLabel: "Open your dashboard", ctaUrl: CREATOR_HOME_HREF };
}

const FALLBACKS = Object.fromEntries(BROADCAST_TOKENS.map(({ token, fallback }) => [token, fallback]));

/** Fills the tokens for one recipient; a missing value reads naturally ("your gig") instead of leaving a gap. */
export function fillTokens(value: string, name: string, vars: BroadcastVars = {}) {
  return value.replace(/\{(first_name|gig_title|company|handle|code|gig_link)\}/gi, (_, key: string) => {
    const token = key.toLowerCase();
    if (token === "first_name") return firstName(name) || FALLBACKS.first_name;
    return vars[token as keyof BroadcastVars]?.trim() || FALLBACKS[token] || "";
  })
    // "@your account" reads badly when the handle is missing.
    .replace(/@your account/g, "your account");
}

/** An absolute https link for the button: site paths become links on the site; anything that isn't http(s) is dropped. */
export function broadcastLink(url: string | undefined, siteUrl: string) {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  try {
    const resolved = new URL(raw, `${siteUrl.replace(/\/+$/, "")}/`);
    return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.toString() : null;
  } catch {
    return null;
  }
}

/** The email for one recipient. */
export function renderBroadcast(content: BroadcastContent, recipient: Pick<BroadcastRecipient, "name" | "vars">, options: { siteUrl: string; unsubscribeUrl?: string | null }) {
  const vars = recipient.vars ?? {};
  const personal = (value: string) => fillTokens(value, recipient.name, vars);
  // A button pointing at {gig_link} falls back to the gigs page for someone without a gig.
  const href = broadcastLink(fillTokens(content.ctaUrl ?? "", recipient.name, vars) || (content.ctaUrl?.includes("{gig_link}") ? FIND_GIGS_HREF : ""), options.siteUrl);
  const gig = content.kind === "promotion" ? content.gig : null;
  const subject = personal(content.subject);
  const rendered = renderBrandEmail({
    siteUrl: options.siteUrl,
    preheader: personal(content.message).replace(/\s+/g, " ").slice(0, 140),
    eyebrow: content.kind === "terms" ? "Terms of Service" : content.kind === "reminder" ? (vars.gig_title ? "Your application" : "Your account") : content.kind === "promotion" ? "New gig" : "Announcement",
    title: personal(content.title),
    tone: content.kind === "terms" || content.kind === "reminder" ? "warning" : "success",
    illustration: content.kind === "terms" ? "security" : content.kind === "reminder" ? "attention" : content.kind === "promotion" ? "welcome" : "inbox",
    intro: personal(content.message),
    highlights: content.kind === "reminder" && vars.gig_title
      ? [
          { label: "Gig", value: vars.gig_title },
          ...(vars.company ? [{ label: "Company", value: vars.company }] : []),
          ...(vars.handle ? [{ label: "Account", value: `@${vars.handle}` }] : []),
          ...(vars.code ? [{ label: "Bio code", value: vars.code }] : []),
        ]
      : gig
      ? [
          { label: "Company", value: gig.company },
          { label: "Pay", value: [gig.payout, gig.payoutType].filter(Boolean).join(" · ") },
          ...(gig.platform ? [{ label: "Platform", value: gig.platform }] : []),
        ]
      : undefined,
    cta: href && content.ctaLabel?.trim() ? { label: content.ctaLabel.trim(), href } : undefined,
    note: isPromotional(content.kind)
      ? `You're getting this because you have a Reelencer creator account.${options.unsubscribeUrl ? ` Don't want emails like this? Unsubscribe: ${options.unsubscribeUrl}` : ""}`
      : content.kind === "reminder"
        ? "You're getting this because of your Reelencer application. Reply to this email if you need a hand."
        : "This is a service notice about your Reelencer account, so it's sent to every creator.",
  });
  return { subject, ...rendered };
}
