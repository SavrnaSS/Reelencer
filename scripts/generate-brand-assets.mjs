import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "assets/brand/logo-source.png"));
const output = path.join(root, "public/brand");
await mkdir(output, { recursive: true });

// Ignore nearly invisible pixels outside the artwork when measuring its padding.
// Keep the supplied colours and transparency; every output includes the whole mark.
const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let left = info.width, top = info.height, right = -1, bottom = -1;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] <= 8) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
}
if (right < left || bottom < top) throw new Error("The logo source contains no visible artwork.");
left = Math.max(0, left - 4); top = Math.max(0, top - 4);
right = Math.min(info.width - 1, right + 4); bottom = Math.min(info.height - 1, bottom + 4);
const artwork = await sharp(source).extract({ left, top, width: right - left + 1, height: bottom - top + 1 }).png().toBuffer();
const clear = { r: 0, g: 0, b: 0, alpha: 0 };
const tileBackground = "#f5faf7";

async function square(size, fraction = 0.94, background = clear) {
  const artworkSize = Math.round(size * fraction);
  const mark = await sharp(artwork).resize(artworkSize, artworkSize, { fit: "contain", background: clear }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, left: Math.floor((size - artworkSize) / 2), top: Math.floor((size - artworkSize) / 2) }])
    .png({ compressionLevel: 9 }).toBuffer();
}

function ico(entries) {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, index) => {
    const start = 6 + index * 16;
    header[start] = size === 256 ? 0 : size; header[start + 1] = header[start];
    header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(png.length, start + 8); header.writeUInt32LE(offset, start + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map(entry => entry.png)]);
}

async function save(name, extension, buffer) {
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  const filename = `${name}.${hash}.${extension}`;
  await writeFile(path.join(output, filename), buffer);
  return `/brand/${filename}`;
}

const logoPng = await square(512);
const logoWebp = await sharp(logoPng).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer();
// Email: the same mark on the same rounded tile as the app's logo (white → sage, hairline edge), baked into the
// image so every mail client shows it identically. Mail apps that force dark mode recolour backgrounds and text but
// never image pixels, so a transparent mark could vanish on a dark header while this tile can't. 144px = 3x for the
// 48px header slot (also used at 28px in the footer). Only the rounded corners stay transparent.
async function emailTile(size) {
  const radius = Math.round(size * 0.24);
  const edge = Math.max(2, Math.round(size / 48));
  const tile = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef3ec"/></linearGradient></defs>
  <rect x="${edge / 2}" y="${edge / 2}" width="${size - edge}" height="${size - edge}" rx="${radius}" fill="url(#g)" stroke="#dbe6d6" stroke-width="${edge}"/>
</svg>`);
  const markSize = Math.round(size * 0.72);
  const mark = await sharp(artwork).resize(markSize, markSize, { fit: "contain", background: clear }).png().toBuffer();
  return sharp(tile)
    .composite([{ input: mark, left: Math.floor((size - markSize) / 2), top: Math.floor((size - markSize) / 2) }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}
const emailPng = await emailTile(144);
const favicon16 = await square(16, 1);
const favicon32 = await square(32, 1);
const favicon48 = await square(48, 1);
const favicon = ico([{ size: 16, png: favicon16 }, { size: 32, png: favicon32 }, { size: 48, png: favicon48 }]);
const icon192 = await square(192, 0.86, tileBackground);
const icon512 = await square(512, 0.86, tileBackground);
// A 56% square fits entirely inside the maskable icon's central 80% safe circle.
const maskable512 = await square(512, 0.56, tileBackground);
const apple180 = await square(180, 0.86, tileBackground);
const shareBackground = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><radialGradient id="glow"><stop stop-color="#cff8e6"/><stop offset="1" stop-color="#f5faf7"/></radialGradient></defs>
  <rect width="1200" height="630" fill="#f5faf7"/>
  <circle cx="200" cy="315" r="310" fill="url(#glow)"/>
  <text x="460" y="285" fill="#172d25" font-family="Georgia,serif" font-weight="700" font-size="82">Reelencer</text>
  <text x="465" y="335" fill="#387f66" font-family="Arial,sans-serif" font-size="19" font-weight="700" letter-spacing="4">BUILT FOR CREATORS</text>
  <text x="465" y="403" fill="#596c61" font-family="Arial,sans-serif" font-size="25">Work with brands.</text>
  <text x="465" y="443" fill="#596c61" font-family="Arial,sans-serif" font-size="25">Get paid for the reels you create.</text>
</svg>`);
const shareMark = await sharp(logoPng).resize(330, 330).png().toBuffer();
const share = await sharp(shareBackground).composite([{ input: shareMark, left: 88, top: 145 }]).png({ compressionLevel: 9 }).toBuffer();

const assets = {
  logo: await save("logo", "webp", logoWebp),
  logoPng: await save("logo", "png", logoPng),
  emailLogo: await save("email-logo", "png", emailPng),
  favicon: await save("favicon", "ico", favicon),
  favicon16: await save("favicon-16", "png", favicon16),
  favicon32: await save("favicon-32", "png", favicon32),
  icon192: await save("icon-192", "png", icon192),
  icon512: await save("icon-512", "png", icon512),
  maskable512: await save("icon-maskable-512", "png", maskable512),
  apple180: await save("apple-touch-icon", "png", apple180),
  share: await save("share", "png", share),
};
await writeFile(path.join(output, "assets.json"), `${JSON.stringify(assets, null, 2)}\n`);

// Keep old public URLs and Next's file-based metadata icons on the same artwork.
for (const [filename, buffer] of [
  ["public/logo-mark.png", logoPng], ["public/logo-mark.webp", logoWebp],
  ["public/reelencer-logo-transparent-v1.png", logoPng],
  ["public/icon-192.png", icon192], ["public/icon-512.png", icon512],
  ["public/icon-maskable-512.png", maskable512], ["public/og-image.png", share],
  ["public/ChatGPT Image Feb 15, 2026, 12_46_15 PM.png", share],
  ["app/icon.png", icon512], ["app/apple-icon.png", apple180], ["app/favicon.ico", favicon],
]) await writeFile(path.join(root, filename), buffer);
await sharp(share).jpeg({ quality: 94, mozjpeg: true }).toFile(path.join(root, "public/reelencer-logo-hq.jpg"));
await writeFile(path.join(root, "public/logo-mark.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Reelencer sailboat logo"><image href="data:image/png;base64,${logoPng.toString("base64")}" width="512" height="512"/></svg>\n`);
await copyFile(path.join(root, "assets/brand/logo-source.png"), path.join(output, "logo-source.png"));
console.log(JSON.stringify({ assets, webpBytes: logoWebp.length, emailBytes: emailPng.length, crop: { left, top, right, bottom } }, null, 2));
