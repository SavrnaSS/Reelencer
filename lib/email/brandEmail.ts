// One branded, responsive template for every email Reelencer sends (account, applications, KYC).
// Email clients ignore most modern CSS, so the layout is table-based with inline styles; the <style> block only
// adds progressive enhancements: stacked cards and full-width buttons on phones, and a dark palette where supported.
// Pure module (no server imports) so it can be rendered and previewed anywhere.
import { BRAND_ASSETS } from "@/lib/brand";

export type EmailTone = "neutral" | "success" | "warning" | "closed";

export type BrandEmailInput = {
  siteUrl: string;
  /** Inbox preview line shown after the subject. Defaults to the intro. */
  preheader?: string;
  eyebrow: string;
  title: string;
  tone?: EmailTone;
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
        ? `<a class="link" href="${url}" target="_blank" style="color:#2f7a1f;text-decoration:underline;word-break:break-all;">${url}</a>`
        : `<a class="${tone === "strong" ? "text-strong" : "link"}" href="mailto:${match}" style="color:${tone === "strong" ? "#163229" : "#2f7a1f"};font-weight:700;text-decoration:none;">${match}</a>`,
    )
    .replace(/\r?\n/g, "<br>");
const escLines = (value: string) => rich(value);

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
const SERIF = "Georgia,'Times New Roman',serif";

// Eyebrow pill + highlight accent per tone. The header is light by default (see "Header" below), so pills are
// dark-on-light; `dark*` values are restored by the prefers-color-scheme CSS along with the dark header.
const TONES: Record<EmailTone, { pill: string; pillBorder: string; darkPill: string; darkBorder: string; accent: string; symbol: string }> = {
  neutral: { pill: "#2f6b55", pillBorder: "#bcdccb", darkPill: "#bfe7d4", darkBorder: "#3c6b5a", accent: "#5fae8c", symbol: "&#9679;" },
  success: { pill: "#2f7a1f", pillBorder: "#b7df9b", darkPill: "#aef07f", darkBorder: "#4d7a35", accent: "#6cc93f", symbol: "&#10003;" },
  warning: { pill: "#94570a", pillBorder: "#efd29c", darkPill: "#ffd08a", darkBorder: "#7a6334", accent: "#e0a23a", symbol: "!" },
  closed: { pill: "#5a6b63", pillBorder: "#cfd9d3", darkPill: "#d5dcd8", darkBorder: "#55655d", accent: "#9aaca3", symbol: "&#9679;" },
};

/**
 * Bulletproof button: a real VML button for Outlook desktop (which ignores padding/radius on links),
 * and a styled link everywhere else.
 */
function button(label: string, href: string, kind: "primary" | "secondary") {
  const primary = kind === "primary";
  const text = primary ? `${esc(label)} &nbsp;&#8594;` : esc(label);
  const width = Math.max(primary ? 200 : 170, Math.round(label.length * 8.6 + (primary ? 84 : 56)));
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(href)}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="50%" ${primary ? 'stroke="f" fillcolor="#8fe05f"' : 'strokecolor="#cfdcc9" fillcolor="#ffffff"'}>
<w:anchorlock/><center style="color:${primary ? "#0b1914" : "#1f4f43"};font-family:Arial,sans-serif;font-size:${primary ? 15 : 14}px;font-weight:bold;">${text}</center>
</v:roundrect>
<![endif]--><!--[if !mso]><!-- --><a ${primary ? "" : 'class="link-btn" '}href="${esc(href)}" target="_blank" style="display:inline-block;${primary ? "" : "border:1px solid #cfdcc9;background:#ffffff;"}padding:${primary ? "15px 28px" : "13px 22px"};font:${primary ? 800 : 700} ${primary ? 15 : 14}px/1 ${FONT};color:${primary ? "#0b1914" : "#1f4f43"};text-decoration:none;border-radius:999px;mso-hide:all;">${text}</a><!--<![endif]-->`;
}

/** First name for a friendly greeting, or "" when the name is missing/placeholder. */
export function firstName(name: string | null | undefined) {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return first && first.toLowerCase() !== "there" ? first : "";
}

export function renderBrandEmail(input: BrandEmailInput): { html: string; text: string } {
  const site = input.siteUrl.replace(/\/+$/, "");
  // One logo for every email: the tile-baked mark from scripts/generate-brand-assets.mjs (144px, 3x).
  const logo = esc(new URL(BRAND_ASSETS.emailLogo, emailAssetOrigin(site)).href);
  const tone = TONES[input.tone ?? "neutral"];
  const year = new Date().getFullYear();
  const preheader = input.preheader ?? input.intro;
  const highlights = (input.highlights ?? []).filter((h) => h.value.trim());
  const sections = (input.sections ?? []).filter((s) => s.value.trim());
  const steps = input.steps ?? [];

  const highlightRows: string[] = [];
  for (let i = 0; i < highlights.length; i += 2) {
    const pair = highlights.slice(i, i + 2);
    highlightRows.push(`<tr>${pair
      .map(
        (h, j) => `
                  <td class="hl" width="50%" valign="top" style="padding:0 ${j === 0 && pair.length > 1 ? "6px" : "0"} 12px ${j === 1 ? "6px" : "0"};">
                    <div class="panel" style="border:1px solid #e1eadd;border-left:3px solid ${tone.accent};border-radius:14px;background:#f6faf4;padding:12px 14px;">
                      <div class="text-muted" style="font:800 10px/1.2 ${FONT};letter-spacing:0.16em;text-transform:uppercase;color:#7b8f84;">${esc(h.label)}</div>
                      <div class="text-strong" style="margin-top:5px;font:700 15px/1.4 ${FONT};color:#163229;">${escLines(h.value)}</div>
                    </div>
                  </td>`,
      )
      .join("")}${pair.length === 1 ? `<td class="hl hl-empty" width="50%" style="padding:0 0 12px 6px;"></td>` : ""}</tr>`);
  }

  const sectionHtml = sections
    .map(
      (s) => `
              <tr>
                <td style="padding:0 0 18px 0;">
                  <div class="text-muted" style="font:800 10px/1.2 ${FONT};letter-spacing:0.16em;text-transform:uppercase;color:#7b8f84;">${esc(s.label)}</div>
                  <div class="text-body" style="margin-top:6px;font:400 15px/1.65 ${FONT};color:#2f4b3f;">${escLines(s.value)}</div>
                </td>
              </tr>`,
    )
    .join("");

  const stepHtml = steps
    .map(
      (step, index) => `
              <tr>
                <td valign="top" width="40" style="padding:0 0 14px 0;">
                  <div class="step-dot" style="width:28px;height:28px;border-radius:999px;background:#e9f7df;color:#2f7a1f;font:800 13px/28px ${FONT};text-align:center;">${index + 1}</div>
                </td>
                <td valign="top" style="padding:3px 0 14px 0;">
                  <div class="text-strong" style="font:700 15px/1.4 ${FONT};color:#163229;">${esc(step.title)}</div>
                  <div class="text-muted" style="margin-top:2px;font:400 14px/1.55 ${FONT};color:#5b7268;">${esc(step.body)}</div>
                </td>
              </tr>`,
    )
    .join("");

  const buttons = input.cta
    ? `
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" class="btn-wrap" style="margin-top:26px;">
                <tr>
                  <td class="btn" bgcolor="#8fe05f" style="border-radius:999px;background:#8fe05f;box-shadow:0 10px 24px rgba(110,190,70,0.28);">
                    ${button(input.cta.label, input.cta.href, "primary")}
                  </td>
                  ${
                    input.secondaryCta
                      ? `<td class="btn-gap" width="10" style="font-size:0;line-height:0;">&nbsp;</td>
                  <td class="btn">
                    ${button(input.secondaryCta.label, input.secondaryCta.href, "secondary")}
                  </td>`
                      : ""
                  }
                  ${input.ctaNote ? `<td class="chip-cell" style="padding-left:14px;"><span class="text-muted" style="font:600 12px/1 ${FONT};color:#6b8378;">&#9201; ${esc(input.ctaNote)}</span></td>` : ""}
                </tr>
              </table>`
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
    a { color:#2f7a1f; }
    /* Stop clients from restyling detected phone numbers/addresses/dates. */
    a[x-apple-data-detectors], u + #body a, #MessageViewBody a { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
    @media only screen and (max-width:600px) {
      .outer { padding:12px 8px !important; }
      .px { padding-left:22px !important; padding-right:22px !important; }
      .title { font-size:27px !important; line-height:1.18 !important; }
      .hl { display:block !important; width:100% !important; padding:0 0 10px 0 !important; box-sizing:border-box; }
      .hl-empty { display:none !important; }
      .btn-wrap, .btn-wrap tbody, .btn-wrap tr, .btn-wrap td { display:block !important; width:100% !important; box-sizing:border-box; }
      .btn a { display:block !important; text-align:center !important; }
      .btn-gap { height:10px !important; }
      .chip-cell { padding:12px 0 0 0 !important; text-align:center !important; }
      .hide-sm { display:none !important; }
      .logo, .logo img { width:40px !important; height:40px !important; }
      .hdr-word { font-size:19px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .page { background:#06120f !important; }
      .hdr { background-color:#0b2b23 !important; background-image:linear-gradient(135deg,#0f4a3b 0%,#0a2f26 55%,#061a15 100%) !important; border-color:#1d3a31 !important; border-top-color:#8fe05f !important; }
      .hdr-word, .hdr-title { color:#ffffff !important; }
      .hdr-tag { color:#9eea6d !important; }
      .pill { background:transparent !important; color:${tone.darkPill} !important; border-color:${tone.darkBorder} !important; }
      .card { background:#0d1f1a !important; border-color:#1d3a31 !important; }
      .text-strong { color:#eef6f1 !important; }
      .text-body { color:#cfdcd5 !important; }
      .text-muted, .foot { color:#a3b8ae !important; }
      .panel { background:#0a1915 !important; border-color:#1d3a31 !important; }
      .step-dot { background:#1b3a22 !important; color:#aef07f !important; }
      .rule { border-color:#1d3a31 !important; }
      .link { color:#9eea6d !important; }
      .link-btn { color:#9eea6d !important; background:#0d1f1a !important; border-color:#2a4a3f !important; }
    }
    [data-ogsc] .card { background:#0d1f1a !important; }
    [data-ogsc] .text-strong { color:#eef6f1 !important; }
    [data-ogsc] .text-body { color:#cfdcd5 !important; }
    [data-ogsc] .text-muted { color:#a3b8ae !important; }
    [data-ogsc] .link, [data-ogsc] .link-btn { color:#9eea6d !important; }
  </style>
</head>
<body id="body" class="page" style="margin:0;padding:0;background:#eef4ea;">
  <div role="article" aria-roledescription="email" aria-label="${esc(input.title)}" lang="en" dir="ltr">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader.slice(0, 140))}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="page" bgcolor="#eef4ea" style="background:#eef4ea;">
    <tr>
      <td align="center" class="outer" style="padding:32px 16px;">
        <!--[if mso]><table role="presentation" width="600" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
          <!-- Header -->
          <tr>
            <!--
              Light header built from solid colours only. Apps that force-invert email colours in dark mode (Gmail and
              Outlook on iOS/Android) flip a solid background together with its text, so this stays readable there.
              A dark gradient header + white text breaks in those apps: gradients aren't inverted but the text is.
              Clients that honour prefers-color-scheme (Apple Mail, iOS Mail) get the dark-green header via CSS.
            -->
            <td class="hdr px" bgcolor="#eaf6e2" style="border-radius:24px 24px 0 0;background-color:#eaf6e2;border:1px solid #d3e6c8;border-bottom:0;border-top:4px solid #8fe05f;padding:26px 36px 28px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td valign="middle" style="padding-right:12px;">
                    <!-- Same tile colour behind the image, so the slot still looks branded while images are blocked. -->
                    <div class="logo" style="width:48px;height:48px;border-radius:12px;background:#f3f7f1;">
                      <img src="${logo}" width="48" height="48" alt="" border="0" style="display:block;width:48px;height:48px;max-width:48px;border:0;border-radius:12px;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;">
                    </div>
                  </td>
                  <td valign="middle">
                    <div class="hdr-word" style="font:700 21px/1 ${SERIF};color:#0f3d31;letter-spacing:-0.01em;">Reelencer</div>
                    <div class="hdr-tag" style="margin-top:4px;font:800 9px/1 ${FONT};letter-spacing:0.22em;text-transform:uppercase;color:#3f8a2a;">Built for creators</div>
                  </td>
                </tr>
              </table>
              <div class="pill" style="margin-top:24px;display:inline-block;border:1px solid ${tone.pillBorder};border-radius:999px;background:#ffffff;padding:5px 11px;font:800 10px/1.2 ${FONT};letter-spacing:0.18em;text-transform:uppercase;color:${tone.pill};"><span style="font-size:11px;">${tone.symbol}</span>&nbsp; ${esc(input.eyebrow)}</div>
              <h1 class="title hdr-title" style="margin:14px 0 0;font:700 31px/1.15 ${SERIF};color:#10261f;letter-spacing:-0.015em;">${esc(input.title)}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td class="card px" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #dbe6d6;border-top:0;border-radius:0 0 24px 24px;padding:30px 36px 32px;">
              ${input.greeting ? `<p class="text-strong" style="margin:0 0 8px;font:700 16px/1.5 ${FONT};color:#163229;">${esc(input.greeting)}</p>` : ""}
              <p class="text-body" style="margin:0;font:400 15px/1.65 ${FONT};color:#4d6a5e;">${escLines(input.intro)}</p>
              ${highlightRows.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;">${highlightRows.join("")}</table>` : ""}
              ${sectionHtml ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:${highlightRows.length ? "10px" : "22px"};">${sectionHtml}</table>` : ""}
              ${buttons}
              ${
                stepHtml
                  ? `<div class="rule" style="margin:28px 0 20px;border-top:1px solid #e6eee3;"></div>
              <div class="text-muted" style="margin-bottom:14px;font:800 10px/1 ${FONT};letter-spacing:0.18em;text-transform:uppercase;color:#7b8f84;">What happens next</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${stepHtml}
              </table>`
                  : ""
              }
              ${
                input.fallbackLink
                  ? `<div class="panel" style="margin-top:${stepHtml ? "8px" : "26px"};border:1px solid #e1eadd;border-radius:14px;background:#f6faf4;padding:14px 16px;">
                <div class="text-muted" style="font:600 12px/1.5 ${FONT};color:#5b7268;">Button not working? Paste this link into your browser:</div>
                <a class="link" href="${esc(input.fallbackLink)}" target="_blank" style="display:block;margin-top:6px;font:500 12px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#2f7a1f;word-break:break-all;">${esc(input.fallbackLink)}</a>
              </div>`
                  : ""
              }
              ${input.note ? `<p class="text-muted" style="margin:24px 0 0;font:400 13px/1.6 ${FONT};color:#6b8378;">${escLines(input.note)}</p>` : ""}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" class="foot" style="padding:24px 16px 6px;font:400 12px/1.8 ${FONT};color:#7b8f84;">
              <a href="${esc(site)}" target="_blank" style="display:inline-block;text-decoration:none;"><img src="${logo}" width="28" height="28" alt="Reelencer" border="0" style="display:block;margin:0 auto 10px;width:28px;height:28px;border:0;border-radius:7px;outline:none;font:700 12px/28px ${SERIF};color:#0f3d31;"></a>
              <a class="link" href="${esc(site)}/dashboard" target="_blank" style="color:#2f7a1f;font-weight:700;text-decoration:none;">Dashboard</a>
              &nbsp;&middot;&nbsp;
              <a class="link" href="${esc(site)}/dashboard?section=find" target="_blank" style="color:#2f7a1f;font-weight:700;text-decoration:none;">Find gigs</a>
              &nbsp;&middot;&nbsp;
              <a class="link" href="mailto:support@reelencer.com" style="color:#2f7a1f;font-weight:700;text-decoration:none;">Help</a>
              <br>
              <span>Reelencer &middot; Built for creators<span class="hide-sm"> &middot; Get paid for the reels you love</span></span><br>
              <span style="color:#9aaca3;">This is a service email about your Reelencer account. &copy; ${year} Reelencer</span>
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
    "Need help? support@reelencer.com",
  ]
    .filter((line, i, all) => !(line === "" && (i === 0 || all[i - 1] === "")))
    .join("\n");

  return { html, text };
}
