// Editable SVG scenes exported as retina PNGs for email clients that cannot display SVG.
// Keep the whole rounded panel inside the image so forced dark mode cannot recolour its individual layers.
// Existing hashed assets stay available for emails that have already been delivered.
// Run: node scripts/generate-email-art.mjs
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { EMAIL_ART_HEIGHT, EMAIL_ART_KINDS, EMAIL_ART_WIDTH, renderEmailArtSvg } from "./email-art-scenes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public/brand");
const assetsPath = path.join(output, "assets.json");
await mkdir(output, { recursive: true });
const assets = JSON.parse(await readFile(assetsPath, "utf8"));
const emailArt = {};
for (const kind of EMAIL_ART_KINDS) {
  const svg = renderEmailArtSvg(kind);
  const png = await sharp(Buffer.from(svg), { density: 192 })
    .resize(EMAIL_ART_WIDTH * 2, EMAIL_ART_HEIGHT * 2)
    .png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 })
    .toBuffer();
  const hash = createHash("sha256").update(png).digest("hex").slice(0, 12);
  const filename = `email-${kind}.${hash}.png`;
  await writeFile(path.join(output, filename), png);
  emailArt[kind] = `/brand/${filename}`;
}
await writeFile(assetsPath, `${JSON.stringify({ ...assets, emailArt }, null, 2)}\n`);
console.log(JSON.stringify(emailArt, null, 2));
