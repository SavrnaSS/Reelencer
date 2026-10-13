// One branded, responsive template for every email Reelencer sends (account, applications, KYC).
// Calm, product-style layout (brand + recipient above a white card, an illustration, plain readable copy) in the
// creator dashboard's palette: neutral #f3f4f1 canvas, #1a201c ink, #1f2b24 primary buttons, #2e7d4f accents.
// Email clients ignore most modern CSS, so the layout is table-based with inline styles; the <style> block only
// adds progressive enhancements: stacked rows and full-width buttons on phones, and a dark palette where supported.
// Pure module (no server imports) so it can be rendered and previewed anywhere.
import { BRAND_ASSETS } from "@/lib/brand";

export type EmailTone = "neutral" | "success" | "warning" | "closed";
/** Header artwork (scripts/generate-email-art.mjs). Defaults from the tone. */
export type EmailIllustration = "welcome" | "security" | "success" | "attention" | "closed" | "verified" | "inbox";

/**
 * Stand-in for the recipient's address in the header and footer; the mailer (lib/email/send.ts) fills it in with
 * the address the message is actually sent to, so templates don't need to know it.
 */
export const RECIPIENT_TOKEN = "%%REELENCER_RECIPIENT%%";

export type BrandEmailInput = {
  siteUrl: string;
  /** Inbox preview line shown after the subject. Defaults to the intro. */
  preheader?: string;
  eyebrow: string;
  title: string;
  tone?: EmailTone;
  illustration?: EmailIllustration;
  greeting?: string;
  intro: string;
  /** Short fact cards (status, stage, company…); two per row, stacked on phones. */
  highlights?: Array<{ label: string; value: string }>;
  /** Labelled blocks of text (recruiter note, next steps…). Empty values are skipped; newlines are kept. */
  sections?: Array<{ label: string; value: string }>;
  cta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  /** Small note next to the button, e.g. "Expires in 24 hours". */
  ctaNote?: string;
  steps?: Array<{ title: string; body: string }>;
  /** Raw link shown for clients where the button doesn't work. */
  fallbackLink?: string;
  /** Closing line (why they got this / what to do if it wasn't them). */
  note?: string;
};

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const LINKABLE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)'"])|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
/**
 * Escapes text, keeps line breaks, and renders URLs/emails as our own styled links. Without this Gmail and
 * Apple Mail auto-link them in default blue, which breaks the design (and dark mode).
 */
const rich = (value: string, tone: "strong" | "link" = "strong") =>
  esc(value)
    .replace(LINKABLE, (match, url: string | undefined) =>
      url
        ? `<a class="link" href="${url}" target="_blank" style="color:#2e7d4f;text-decoration:underline;word-break:break-all;">${url}</a>`
        : `<a class="${tone === "strong" ? "t-ink" : "link"}" href="mailto:${match}" style="color:${tone === "strong" ? "#1a201c" : "#2e7d4f"};font-weight:600;text-decoration:none;">${match}</a>`,
    )
    .replace(/\r?\n/g, "<br>");

/** Where email images load from. Must be public https: inboxes can't reach localhost, private hosts or preview tunnels. */
const PUBLIC_ORIGIN_FALLBACK = "https://reelencer.com";
function isPublicOrigin(origin: string) {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== "https:") return false;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".test") || hostname.endsWith(".internal")) return false;
    // Private / loopback / link-local IPv4 and IPv6 literals.
    if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(hostname) || hostname.startsWith("[")) return false;
    return true;
  } catch {
    return false;
  }
}
/**
 * Origin for the logo: the email's own site when it's public, else the configured public site, else production.
 * Every email therefore shows the same logo from a reachable URL, including mail sent from dev or preview builds.
 */
export function emailAssetOrigin(site: string) {
  const configured = [process.env.EMAIL_ASSET_ORIGIN, process.env.NEXT_PUBLIC_SITE_URL, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL]
    .map((value) => String(value ?? "").trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return [site, ...configured].find(isPublicOrigin) ?? PUBLIC_ORIGIN_FALLBACK;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Dashboard palette (app/dashboard/dashboardUi.tsx, .creator-dashboard-theme).
const C = {
  canvas: "#f3f4f1",
  card: "#ffffff",
  border: "#e3e5e1",
  hairline: "#ebedea",
  panel: "#fafbf9",
  ink: "#1a201c",
  body: "#3b443e",
  muted: "#616a64",
  faint: "#8a928c",
  button: "#1f2b24",
  green: "#2e7d4f",
  /** Illustration panel; the artwork is rendered on this exact colour (scripts/generate-email-art.mjs). */
  art: "#f4f6f2",
};

// Status chip per tone, matching the dashboard's StatusBadge colours.
const TONES: Record<EmailTone, { bg: string; fg: string; dot: string; art: EmailIllustration; darkBg: string; darkFg: string }> = {
  neutral: { bg: "#eef1ed", fg: "#2b5d4a", dot: "#41695b", art: "inbox", darkBg: "#1f2a24", darkFg: "#b9d5c0" },
  success: { bg: "#e3f1df", fg: "#1f5131", dot: "#2e7d4f", art: "success", darkBg: "#173222", darkFg: "#9fd7ad" },
  warning: { bg: "#fbecd0", fg: "#7a4a0c", dot: "#c58316", art: "attention", darkBg: "#3a2a12", darkFg: "#f3c97f" },
  closed: { bg: "#f1f3f0", fg: "#4b544e", dot: "#8a928c", art: "closed", darkBg: "#242926", darkFg: "#c3cac4" },
};

/**
 * Bulletproof button: a real VML button for Outlook desktop (which ignores padding/radius on links), and a styled
 * link everywhere else. Primary = the dashboard's dark button; secondary = its white outlined button.
 */
function button(label: string, href: string, kind: "primary" | "secondary") {
  const primary = kind === "primary";
  const width = Math.max(primary ? 200 : 160, Math.round(label.length * 8.2 + 56));
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(href)}" style="height:46px;v-text-anchor:middle;width:${width}px;" arcsize="18%" ${primary ? `stroke="f" fillcolor="${C.button}"` : `strokecolor="#d9ddd8" fillcolor="#ffffff"`}>
<w:anchorlock/><center style="color:${primary ? "#ffffff" : C.ink};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${esc(label)}</center>
</v:roundrect>
<![endif]--><!--[if !mso]><!-- --><a class="${primary ? "btn-primary" : "btn-secondary"}" href="${esc(href)}" target="_blank" style="display:inline-block;${primary ? `background:${C.button};border:1px solid ${C.button};` : "background:#ffffff;border:1px solid #d9ddd8;"}padding:14px 24px;font:600 15px/1.1 ${FONT};color:${primary ? "#ffffff" : C.ink};text-decoration:none;border-radius:8px;mso-hide:all;">${esc(label)}</a><!--<![endif]-->`;
}

/** First name for a friendly greeting, or "" when the name is missing/placeholder. */
export function firstName(name: string | null | undefined) {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return first && first.toLowerCase() !== "there" ? first : "";
}

/** Replaces the recipient placeholder (see RECIPIENT_TOKEN) with the real address, escaped for HTML. */
export function fillRecipient(content: { html: string; text?: string }, address: string) {
  return {
    html: content.html.split(RECIPIENT_TOKEN).join(esc(address)),
    text: content.text?.split(RECIPIENT_TOKEN).join(address),
  };
}

export function renderBrandEmail(input: BrandEmailInput): { html: string; text: string } {
  const site = input.siteUrl.replace(/\/+$/, "");
  const origin = emailAssetOrigin(site);
  // One logo for every email: the tile-baked mark from scripts/generate-brand-assets.mjs (144px, 3x).
  const logo = esc(new URL(BRAND_ASSETS.emailLogo, origin).href);
  const tone = TONES[input.tone ?? "neutral"];
  const artPath = BRAND_ASSETS.emailArt[input.illustration ?? tone.art];
  const art = artPath ? esc(new URL(artPath, origin).href) : "";
  const year = new Date().getFullYear();
  const preheader = input.preheader ?? input.intro;
  const highlights = (input.highlights ?? []).filter((h) => h.value.trim());
  const sections = (input.sections ?? []).filter((s) => s.value.trim());
  const steps = input.steps ?? [];
  const label = (text: string) =>
    `<div class="t-muted" style="font:600 12px/1.4 ${FONT};color:${C.muted};">${esc(text)}</div>`;

  // Key facts as a tidy two-column list (label | value); stacks on phones.
  const highlightHtml = highlights.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="panel" style="margin-top:24px;border:1px solid ${C.hairline};border-radius:10px;background:${C.panel};border-collapse:separate;">
${highlights
  .map(
    (h, i) => `                <tr>
                  <td class="kv-k" valign="top" width="38%" style="padding:12px 16px;${i ? `border-top:1px solid ${C.hairline};` : ""}font:500 13px/1.5 ${FONT};color:${C.muted};">${esc(h.label)}</td>
                  <td class="kv-v t-ink" valign="top" style="padding:12px 16px;${i ? `border-top:1px solid ${C.hairline};` : ""}font:600 14px/1.5 ${FONT};color:${C.ink};">${rich(h.value)}</td>
                </tr>`,
  )
  .join("\n")}
              </table>`
    : "";

  const sectionHtml = sections
    .map(
      (s) => `
              <div style="margin-top:22px;">
                ${label(s.label)}
                <div class="t-body" style="margin-top:4px;font:400 15px/1.6 ${FONT};color:${C.body};">${rich(s.value)}</div>
              </div>`,
    )
    .join("");

  const stepHtml = steps.length
    ? `
              <div class="rule" style="margin:30px 0 18px;border-top:1px solid ${C.hairline};"></div>
              <div class="t-ink" style="margin-bottom:12px;font:600 14px/1.4 ${FONT};color:${C.ink};">What happens next</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
${steps
  .map(
    (step, index) => `                <tr>
                  <td valign="top" width="36" style="padding:0 0 14px 0;">
                    <div class="step-dot" style="width:24px;height:24px;border-radius:999px;background:#e3f1df;color:#1f5131;font:700 12px/24px ${FONT};text-align:center;">${index + 1}</div>
                  </td>
                  <td valign="top" style="padding:2px 0 14px 0;">
                    <div class="t-ink" style="font:600 14px/1.45 ${FONT};color:${C.ink};">${esc(step.title)}</div>
                    <div class="t-muted" style="margin-top:2px;font:400 14px/1.55 ${FONT};color:${C.muted};">${esc(step.body)}</div>
                  </td>
                </tr>`,
  )
  .join("\n")}
              </table>`
    : "";

  const buttons = input.cta
    ? `
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" class="btn-wrap" style="margin:30px auto 0;">
                <tr>
                  <td class="btn" align="center" style="border-radius:8px;">${button(input.cta.label, input.cta.href, "primary")}</td>
                  ${
                    input.secondaryCta
                      ? `<td class="btn-gap" width="10" style="font-size:0;line-height:0;">&nbsp;</td>
                  <td class="btn" align="center" style="border-radius:8px;">${button(input.secondaryCta.label, input.secondaryCta.href, "secondary")}</td>`
                      : ""
                  }
                </tr>
              </table>
              ${input.ctaNote ? `<div class="t-muted" style="margin-top:12px;text-align:center;font:500 13px/1.4 ${FONT};color:${C.muted};">${esc(input.ctaNote)}</div>` : ""}`
    : "";

  const html = `<!doctype html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <title>${esc(input.title)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>td,th,div,p,a,h1,span { font-family:Arial,Helvetica,sans-serif !important; } table { border-collapse:collapse; }</style>
  <![endif]-->
  <style>
    body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; }
    a { color:${C.green}; }
    /* Stop clients from restyling detected phone numbers/addresses/dates. */
    a[x-apple-data-detectors], u + #body a, #MessageViewBody a { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
    .btn-primary:hover { background:#2b3a31 !important; }
    .btn-secondary:hover { background:#f7f8f6 !important; }
    @media only screen and (max-width:600px) {
      .outer { padding:16px 10px 24px !important; }
      .px { padding-left:22px !important; padding-right:22px !important; }
      .top { padding-left:4px !important; padding-right:4px !important; }
      .hero img { width:240px !important; height:auto !important; }
      .title { font-size:22px !important; line-height:1.3 !important; }
      .kv-k, .kv-v { display:block !important; width:auto !important; }
      .kv-k { padding-bottom:0 !important; }
      .kv-v { padding-top:2px !important; border-top:0 !important; }
      .btn-wrap, .btn-wrap tbody, .btn-wrap tr, .btn-wrap td { display:block !important; width:100% !important; box-sizing:border-box; }
      .btn a { display:block !important; text-align:center !important; }
      .btn-gap { height:10px !important; }
      .rcpt { font-size:12px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .page { background:#111513 !important; }
      .card { background:#1a1f1c !important; border-color:#2a312d !important; }
      .t-ink, .brand { color:#eef2ee !important; }
      .t-body { color:#cdd5cf !important; }
      .t-muted, .foot, .rcpt { color:#a2aca5 !important; }
      .panel { background:#151916 !important; border-color:#2a312d !important; }
      .kv-k, .kv-v { border-color:#2a312d !important; }
      .rule { border-color:#2a312d !important; }
      .chip { background:${tone.darkBg} !important; color:${tone.darkFg} !important; }
      .step-dot { background:#173222 !important; color:#9fd7ad !important; }
      .link { color:#8fd3a3 !important; }
      .btn-primary { background:#eef2ee !important; border-color:#eef2ee !important; color:#111513 !important; }
      .btn-secondary { background:#1a1f1c !important; border-color:#3a433d !important; color:#eef2ee !important; }
    }
    [data-ogsc] .t-ink, [data-ogsc] .brand { color:#eef2ee !important; }
    [data-ogsc] .t-body { color:#cdd5cf !important; }
    [data-ogsc] .t-muted, [data-ogsc] .rcpt { color:#a2aca5 !important; }
    [data-ogsc] .link { color:#8fd3a3 !important; }
  </style>
</head>
<body id="body" class="page" style="margin:0;padding:0;background:${C.canvas};">
  <div role="article" aria-roledescription="email" aria-label="${esc(input.title)}" lang="en" dir="ltr">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader.slice(0, 140))}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="page" bgcolor="${C.canvas}" style="background:${C.canvas};">
    <tr>
      <td align="center" class="outer" style="padding:28px 16px 36px;">
        <!--[if mso]><table role="presentation" width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
          <!-- Brand and recipient, above the card -->
          <tr>
            <td class="top" style="padding:0 6px 18px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td valign="middle">
                    <a href="${esc(site)}" target="_blank" style="text-decoration:none;">
                      <img src="${logo}" width="32" height="32" alt="" border="0" style="display:inline-block;vertical-align:middle;width:32px;height:32px;border:0;border-radius:8px;outline:none;">
                      <span class="brand" style="display:inline-block;vertical-align:middle;margin-left:8px;font:700 18px/32px ${FONT};color:${C.ink};letter-spacing:-0.01em;">Reelencer</span>
                    </a>
                  </td>
                  <td valign="middle" align="right" class="rcpt" style="font:500 13px/1.3 ${FONT};color:${C.muted};word-break:break-all;">${RECIPIENT_TOKEN}</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td class="card" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:12px;">
              ${
                art
                  ? `<div style="padding:20px 20px 0;">
                <div class="hero" style="padding:20px 12px;text-align:center;border-radius:10px;background:${C.art};">
                  <img src="${art}" width="280" height="140" alt="" border="0" style="display:inline-block;width:280px;max-width:100%;height:auto;border:0;outline:none;">
                </div>
              </div>`
                  : ""
              }
              <div class="px" style="padding:${art ? "26px" : "36px"} 44px 38px;">
                <div style="text-align:center;">
                  <span class="chip" style="display:inline-block;border-radius:999px;background:${tone.bg};padding:5px 12px;font:600 12px/1.3 ${FONT};color:${tone.fg};"><span style="color:${tone.dot};">&#9679;</span>&nbsp; ${esc(input.eyebrow)}</span>
                  <h1 class="title t-ink" style="margin:14px 0 0;font:600 25px/1.3 ${FONT};color:${C.ink};letter-spacing:-0.015em;">${esc(input.title)}</h1>
                </div>
                <div class="rule" style="margin:26px 0 24px;border-top:1px solid ${C.hairline};"></div>
                ${input.greeting ? `<p class="t-ink" style="margin:0 0 12px;font:400 16px/1.6 ${FONT};color:${C.ink};">${esc(input.greeting)}</p>` : ""}
                <p class="t-body" style="margin:0;font:400 16px/1.65 ${FONT};color:${C.body};">${rich(input.intro)}</p>
                ${highlightHtml}
                ${sectionHtml}
                ${buttons}
                ${stepHtml}
                ${
                  input.fallbackLink
                    ? `<div class="panel" style="margin-top:${stepHtml ? "10px" : "28px"};border:1px solid ${C.hairline};border-radius:10px;background:${C.panel};padding:14px 16px;">
                  <div class="t-muted" style="font:500 13px/1.5 ${FONT};color:${C.muted};">Button not working? Copy this link into your browser:</div>
                  <a class="link" href="${esc(input.fallbackLink)}" target="_blank" style="display:block;margin-top:6px;font:500 12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:${C.green};word-break:break-all;">${esc(input.fallbackLink)}</a>
                </div>`
                    : ""
                }
                ${input.note ? `<p class="t-muted" style="margin:26px 0 0;font:400 14px/1.6 ${FONT};color:${C.muted};">${rich(input.note, "link")}</p>` : ""}
                <p class="t-body" style="margin:26px 0 0;font:400 15px/1.6 ${FONT};color:${C.body};">Thanks,<br><span class="t-ink" style="font-weight:600;color:${C.ink};">The Reelencer team</span></p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" class="foot" style="padding:24px 20px 0;font:400 12px/1.7 ${FONT};color:${C.faint};">
              <a class="link" href="${esc(site)}/dashboard" target="_blank" style="color:${C.muted};font-weight:600;text-decoration:none;">Dashboard</a>
              &nbsp;&middot;&nbsp;
              <a class="link" href="${esc(site)}/dashboard?section=find" target="_blank" style="color:${C.muted};font-weight:600;text-decoration:none;">Find gigs</a>
              &nbsp;&middot;&nbsp;
              <a class="link" href="mailto:support@reelencer.com" style="color:${C.muted};font-weight:600;text-decoration:none;">Help</a>
              <br><br>
              This email was sent to ${RECIPIENT_TOKEN} because it's linked to a Reelencer account. It's a service message, so you'll get it even if you've turned off marketing emails.
              <br><br>
              &copy; ${year} Reelencer &middot; Paid reel gigs for creators
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
  </div>
</body>
</html>`;

  const text = [
    "Reelencer",
    "",
    `${input.eyebrow.toUpperCase()}: ${input.title}`,
    "",
    input.greeting ?? "",
    input.intro,
    ...(highlights.length ? ["", ...highlights.map((h) => `${h.label}: ${h.value}`)] : []),
    ...sections.flatMap((s) => ["", `${s.label}:`, s.value]),
    ...(input.cta ? ["", `${input.cta.label}: ${input.cta.href}`] : []),
    ...(input.secondaryCta ? [`${input.secondaryCta.label}: ${input.secondaryCta.href}`] : []),
    input.ctaNote ? `(${input.ctaNote})` : "",
    ...(steps.length ? ["", "What happens next:", ...steps.map((s, i) => `${i + 1}. ${s.title} - ${s.body}`)] : []),
    ...(input.note ? ["", input.note] : []),
    "",
    "Thanks,",
    "The Reelencer team",
    "",
    `Sent to ${RECIPIENT_TOKEN}. Need help? support@reelencer.com`,
  ]
    .filter((line, i, all) => !(line === "" && (i === 0 || all[i - 1] === "")))
    .join("\n");

  return { html, text };
}
