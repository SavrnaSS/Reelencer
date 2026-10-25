import { isSafeMediaUrl } from "./gigSamples";

export type GigBriefAsset = {
  url: string;
  kind: "image" | "video" | "file";
  name: string;
};

const imagePath = /\.(avif|gif|jpe?g|png|webp|bmp|svg)$/i;
const videoPath = /\.(mp4|m4v|mov|webm|ogv)$/i;

/** Read existing admin uploads and legacy image/video links without mixing in public Sample:: reels. */
export function parseGigBriefAssets(requirements: unknown): GigBriefAsset[] {
  if (!Array.isArray(requirements)) return [];
  const assets = new Map<string, GigBriefAsset>();
  for (const line of requirements) {
    if (typeof line !== "string") continue;
    const explicit = /^media::/i.test(line.trim());
    const value = (explicit ? line.trim().replace(/^media::/i, "") : line).trim();
    if (!isSafeMediaUrl(value) || assets.has(value)) continue;
    const url = new URL(value);
    if (!explicit && !imagePath.test(url.pathname) && !videoPath.test(url.pathname)) continue;
    let name = url.pathname.split("/").pop() || url.hostname;
    try { name = decodeURIComponent(name); } catch { /* Keep malformed legacy filenames usable. */ }
    name = name.replace(/^\d{13}-[a-z0-9]{6}-/i, "");
    const extensionless = !/\.[a-z0-9]{1,8}$/i.test(url.pathname);
    const kind = videoPath.test(url.pathname) ? "video" : imagePath.test(url.pathname) || extensionless ? "image" : "file";
    assets.set(value, { url: value, kind, name });
  }
  return [...assets.values()];
}
