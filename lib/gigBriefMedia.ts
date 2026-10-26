import { isSafeMediaUrl } from "./gigSamples";
import { isReelKitLine } from "./reelKit";

/** An admin-made example of how a reference should look inside the reel (a 9:16 screenshot or clip). */
export type ReelExample = { url: string; kind: "image" | "video" };

export type GigBriefAsset = {
  url: string;
  kind: "image" | "video" | "file";
  name: string;
  reelExample?: ReelExample;
  /** The admin's note on what to show from this reference. */
  note?: string;
};

const imagePath = /\.(avif|gif|jpe?g|png|webp|bmp|svg)$/i;
const videoPath = /\.(mp4|m4v|mov|webm|ogv)$/i;

/**
 * Reel examples ride inside the admin's media list as `Reel::{"for":assetUrl,"url":exampleUrl}`, so they are saved
 * as `Media::Reel::…` requirement lines: hidden wherever Media:: lines are, and skipped by readers that predate them.
 */
export const REEL_EXAMPLE_PREFIX = "Reel::";

const isReelExampleLine = (line: string) => /^reel::/i.test(line.trim());

function readReelExample(line: string): { for: string; example: ReelExample } | null {
  try {
    const raw = JSON.parse(line.trim().slice(REEL_EXAMPLE_PREFIX.length)) as Record<string, unknown>;
    if (!isSafeMediaUrl(raw?.for) || !isSafeMediaUrl(raw?.url)) return null;
    return { for: raw.for, example: { url: raw.url, kind: videoPath.test(new URL(raw.url).pathname) ? "video" : "image" } };
  } catch {
    return null;
  }
}

export function encodeReelExample(forUrl: string, url: string) {
  return `${REEL_EXAMPLE_PREFIX}${JSON.stringify({ for: forUrl, url })}`;
}

/** Per-reference notes ("what to show") travel the same way: `Note::{"for":assetUrl,"text":…}`. */
export const ASSET_NOTE_PREFIX = "Note::";
export const MAX_ASSET_NOTE = 240;

const isAssetNoteLine = (line: string) => /^note::/i.test(line.trim());

/** Raw text for the admin's input (typing keeps its spaces); creators get it tidied in parseGigBriefAssets. */
function readAssetNote(line: string): { for: string; text: string } | null {
  try {
    const raw = JSON.parse(line.trim().slice(ASSET_NOTE_PREFIX.length)) as Record<string, unknown>;
    if (!isSafeMediaUrl(raw?.for) || typeof raw?.text !== "string") return null;
    return { for: raw.for, text: raw.text.slice(0, MAX_ASSET_NOTE) };
  } catch {
    return null;
  }
}

export function encodeAssetNote(forUrl: string, text: string) {
  return `${ASSET_NOTE_PREFIX}${JSON.stringify({ for: forUrl, text: text.slice(0, MAX_ASSET_NOTE) })}`;
}

/** Admin media list (one entry per line, without the Media:: prefix) split into reference URLs, examples and notes. */
export function splitBriefMediaLines(lines: string[]) {
  const assets: string[] = [];
  const examples = new Map<string, ReelExample>();
  const notes = new Map<string, string>();
  for (const line of lines) {
    if (isReelKitLine(line)) continue;
    if (isReelExampleLine(line)) {
      const parsed = readReelExample(line);
      if (parsed) examples.set(parsed.for, parsed.example);
    } else if (isAssetNoteLine(line)) {
      const parsed = readAssetNote(line);
      if (parsed) notes.set(parsed.for, parsed.text);
    } else if (line.trim()) assets.push(line.trim());
  }
  return { assets, examples, notes };
}

/** References first, then their examples and notes (dropping any whose reference is gone), then the reel kit line. */
function rebuildMediaLines(lines: string[], examples: Map<string, ReelExample>, notes: Map<string, string>) {
  const { assets } = splitBriefMediaLines(lines);
  return [
    ...assets,
    ...assets.flatMap(asset => (examples.has(asset) ? [encodeReelExample(asset, examples.get(asset)!.url)] : [])),
    ...assets.flatMap(asset => (notes.get(asset) ? [encodeAssetNote(asset, notes.get(asset)!)] : [])),
    ...lines.filter(isReelKitLine),
  ];
}

/** Sets (or with null, clears) the reel example for one reference. */
export function withReelExample(lines: string[], forUrl: string, url: string | null) {
  const { examples, notes } = splitBriefMediaLines(lines);
  const next = new Map(examples);
  if (url) next.set(forUrl, { url, kind: videoPath.test(new URL(url).pathname) ? "video" : "image" });
  else next.delete(forUrl);
  return rebuildMediaLines(lines, next, notes);
}

/** Sets (or with an empty text, clears) the creator note for one reference. */
export function withAssetNote(lines: string[], forUrl: string, text: string) {
  const { examples, notes } = splitBriefMediaLines(lines);
  const next = new Map(notes);
  if (text.trim()) next.set(forUrl, text.slice(0, MAX_ASSET_NOTE));
  else next.delete(forUrl);
  return rebuildMediaLines(lines, examples, next);
}

/** Read existing admin uploads and legacy image/video links without mixing in public Sample:: reels. */
export function parseGigBriefAssets(requirements: unknown): GigBriefAsset[] {
  if (!Array.isArray(requirements)) return [];
  const assets = new Map<string, GigBriefAsset>();
  const examples = new Map<string, ReelExample>();
  const notes = new Map<string, string>();
  for (const line of requirements) {
    if (typeof line !== "string") continue;
    const explicit = /^media::/i.test(line.trim());
    const value = (explicit ? line.trim().replace(/^media::/i, "") : line).trim();
    if (explicit && isReelExampleLine(value)) {
      const parsed = readReelExample(value);
      if (parsed) examples.set(parsed.for, parsed.example);
      continue;
    }
    if (explicit && isAssetNoteLine(value)) {
      const parsed = readAssetNote(value);
      const text = parsed?.text.replace(/\s+/g, " ").trim();
      if (parsed && text) notes.set(parsed.for, text);
      continue;
    }
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
  return [...assets.values()].map(asset => ({
    ...asset,
    ...(examples.has(asset.url) && asset.kind !== "file" ? { reelExample: examples.get(asset.url) } : {}),
    ...(notes.has(asset.url) ? { note: notes.get(asset.url) } : {}),
  }));
}

/** Supabase storage serves `?download=` as an attachment; other hosts get null and open the original instead. */
export function briefAssetDownloadUrl(asset: GigBriefAsset): string | null {
  const url = new URL(asset.url);
  if (!/\/storage\/v1\/object\/(public|sign)\//.test(url.pathname)) return null;
  url.searchParams.set("download", asset.name);
  return url.toString();
}

export type AssetShape = { orientation: "Vertical" | "Square" | "Landscape"; ratio: string | null };

const COMMON_RATIOS: Array<[number, number]> = [[9, 16], [3, 4], [4, 5], [1, 1], [4, 3], [3, 2], [16, 10], [16, 9]];

/** Orientation plus the nearest familiar ratio (within 3%), so creators know how a picture sits in a 9:16 reel. */
export function describeAssetShape(width: number, height: number): AssetShape | null {
  if (!(width > 0 && height > 0)) return null;
  const value = width / height;
  const orientation = Math.abs(value - 1) <= 0.03 ? "Square" : value < 1 ? "Vertical" : "Landscape";
  const match = COMMON_RATIOS.find(([w, h]) => Math.abs(value - w / h) / (w / h) <= 0.03);
  return { orientation, ratio: match ? `${match[0]}:${match[1]}` : null };
}
