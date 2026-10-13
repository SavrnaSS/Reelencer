// Email header illustrations (one per kind of message), drawn in the creator dashboard's palette and rendered to
// PNG, since Gmail and Outlook don't display SVG. Output: public/brand/email-<name>.<hash>.png at 2x (560×280,
// shown at 280×140), registered in public/brand/assets.json under `emailArt`.
//   node scripts/generate-email-art.mjs
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public/brand");

// Dashboard palette (app/globals.css .creator-dashboard-theme, app/dashboard/dashboardUi.tsx).
const ink = "#1f2b24";
const green = "#2e7d4f";
const greenSoft = "#e3f1df";
const lime = "#dce78f";
const limeSoft = "#edf5c7";
const paper = "#ffffff";
const mist = "#eef1ed";
const line = "#cad5c8";
const amber = "#e0a23a";
const amberSoft = "#fbecd0";
const grey = "#9aa59e";

const stroke = `stroke="${ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`;
const ground = `<path d="M44 132h232" ${stroke} />`;
const sparkle = (x, y, s = 1, fill = ink) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0-9C1-3 3-1 9 0 3 1 1 3 0 9-1 3-3 1-9 0-3-1-1-3 0-9Z" fill="${fill}" />`;
const blob = (cx, cy, r, fill = mist) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" />`;
const badge = (cx, cy, fill, glyph) => `<circle cx="${cx}" cy="${cy}" r="17" fill="${fill}" ${stroke} />${glyph}`;
const check = (cx, cy, color = paper) => `<path d="M${cx - 7} ${cy}l5 5 9-10" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />`;
const textLines = (x, y, widths) => widths.map((w, i) => `<path d="M${x} ${y + i * 9}h${w}" stroke="${line}" stroke-width="3.2" stroke-linecap="round" />`).join("");

const scenes = {
  // Sign-up confirmation / existing account: an envelope with a welcome card rising out of it.
  welcome: `
    ${blob(110, 70, 34)}${blob(222, 104, 22, limeSoft)}
    <rect x="128" y="34" width="64" height="62" rx="6" fill="${paper}" ${stroke} />
    ${textLines(140, 50, [30, 40, 22])}
    <rect x="112" y="72" width="96" height="60" rx="7" fill="${limeSoft}" ${stroke} />
    <path d="M112 76l48 32 48-32" fill="none" ${stroke} />
    ${badge(206, 44, green, check(206, 44))}
    ${sparkle(92, 40, 0.9)}${sparkle(236, 76, 0.7, green)}
    ${ground}`,
  // Password reset: a padlock in front of a shield.
  security: `
    ${blob(118, 72, 32)}${blob(214, 96, 24, greenSoft)}
    <path d="M160 26l36 12v28c0 26-16 44-36 52-20-8-36-26-36-52V38z" fill="${greenSoft}" ${stroke} />
    <path d="M146 72v-10a14 14 0 0 1 28 0v10" fill="none" ${stroke} />
    <rect x="138" y="72" width="44" height="34" rx="6" fill="${paper}" ${stroke} />
    <circle cx="160" cy="86" r="4" fill="${ink}" /><path d="M160 90v7" ${stroke} />
    ${sparkle(212, 40, 0.9)}${sparkle(100, 104, 0.6, green)}
    ${ground}`,
  // Approved / accepted: a document with a green check badge and a little confetti.
  success: `
    ${blob(112, 66, 30, limeSoft)}${blob(216, 100, 26)}
    <rect x="130" y="30" width="66" height="88" rx="7" fill="${paper}" ${stroke} />
    ${textLines(142, 48, [42, 34, 42, 26])}
    <path d="M142 96h22" stroke="${green}" stroke-width="3.2" stroke-linecap="round" />
    ${badge(196, 108, green, check(196, 108))}
    <circle cx="100" cy="38" r="3.5" fill="${green}" /><circle cx="226" cy="40" r="3" fill="${amber}" />
    <rect x="232" y="64" width="7" height="7" rx="1.5" fill="${lime}" transform="rotate(20 235 67)" />
    ${sparkle(88, 96, 0.8)}${sparkle(214, 28, 0.7)}
    ${ground}`,
  // Needs changes: a document being edited, with an amber notice badge.
  attention: `
    ${blob(108, 74, 30)}${blob(220, 98, 24, amberSoft)}
    <rect x="128" y="30" width="66" height="88" rx="7" fill="${paper}" ${stroke} />
    ${textLines(140, 48, [42, 30, 42])}
    <path d="M140 84h18" stroke="${amber}" stroke-width="3.2" stroke-linecap="round" />
    <path d="M206 58l12 12-34 34-15 3 3-15z" fill="${lime}" ${stroke} />
    <path d="M200 64l12 12" ${stroke} />
    ${badge(116, 44, amber, `<path d="M116 36v9" stroke="${paper}" stroke-width="3.4" stroke-linecap="round" /><circle cx="116" cy="51" r="2.2" fill="${paper}" />`)}
    ${sparkle(232, 40, 0.8)}
    ${ground}`,
  // Closed / not selected: a quiet archive box.
  closed: `
    ${blob(114, 72, 30)}${blob(212, 100, 22)}
    <rect x="120" y="54" width="80" height="62" rx="6" fill="${mist}" ${stroke} />
    <rect x="114" y="40" width="92" height="18" rx="5" fill="${paper}" ${stroke} />
    <path d="M148 74h24" ${stroke} />
    <rect x="134" y="20" width="52" height="30" rx="5" fill="${paper}" stroke="${grey}" stroke-width="2.4" stroke-dasharray="4 5" />
    ${sparkle(222, 46, 0.6, grey)}
    ${ground}`,
  // Identity verified: an ID card with a shield check.
  verified: `
    ${blob(110, 64, 30, greenSoft)}${blob(222, 102, 22, limeSoft)}
    <rect x="104" y="48" width="104" height="68" rx="8" fill="${paper}" ${stroke} />
    <circle cx="130" cy="78" r="11" fill="${limeSoft}" ${stroke} />
    <path d="M118 104c3-8 21-8 24 0" fill="none" ${stroke} />
    ${textLines(152, 72, [40, 30, 36])}
    <path d="M214 30l20 7v15c0 14-9 23-20 28-11-5-20-14-20-28V37z" fill="${green}" ${stroke} />
    ${check(214, 54)}
    ${sparkle(92, 36, 0.8)}
    ${ground}`,
  // General updates: an inbox tray with a notification bell.
  inbox: `
    ${blob(110, 70, 30)}${blob(214, 104, 22, limeSoft)}
    <path d="M110 84l16-42h68l16 42v34a6 6 0 0 1-6 6h-88a6 6 0 0 1-6-6z" fill="${paper}" ${stroke} />
    <path d="M110 84h30l6 12h28l6-12h30" fill="none" ${stroke} />
    ${textLines(140, 58, [40, 30])}
    <path d="M222 50a12 12 0 0 1 24 0c0 12 5 15 5 15h-34s5-3 5-15" fill="${lime}" ${stroke} />
    <path d="M230 70a4 4 0 0 0 8 0" fill="none" ${stroke} />
    ${sparkle(96, 40, 0.8)}
    ${ground}`,
};

const assetsPath = path.join(output, "assets.json");
const assets = JSON.parse(await readFile(assetsPath, "utf8"));
const emailArt = {};
for (const [name, body] of Object.entries(scenes)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="280" viewBox="0 0 320 160">${body}</svg>`;
  // Opaque background matching the template's illustration panel (C.art in lib/email/brandEmail.ts), so the image
  // blends into its panel and never shows a dark box in clients that drop transparency.
  const png = await sharp(Buffer.from(svg)).flatten({ background: "#f4f6f2" }).png({ compressionLevel: 9, palette: true, quality: 95 }).toBuffer();
  const hash = createHash("sha256").update(png).digest("hex").slice(0, 12);
  const filename = `email-${name}.${hash}.png`;
  await writeFile(path.join(output, filename), png);
  emailArt[name] = `/brand/${filename}`;
}
await writeFile(assetsPath, `${JSON.stringify({ ...assets, emailArt }, null, 2)}\n`);
console.log(emailArt);
