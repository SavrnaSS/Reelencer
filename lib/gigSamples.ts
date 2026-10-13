// Sample videos admins attach to a gig ("this is the kind of reel we want"). Public: shown to every creator on the
// gig page, unlike `Media::` brief assets, which only accepted workers see in their dashboard.
// Stored as `Sample::{json}` lines in the gig's `requirements` array (same place as Brief::/Meta::/Media::), so no
// schema change is needed. Pure module: shared by the admin form, the creator UI and tests.

export type GigSample = {
  url: string;
  caption?: string;
  /** Poster frame (image URL) so cards don't download video until played. */
  poster?: string;
  /** Seconds. */
  duration?: number;
  /** Intrinsic size, used to pick a vertical (9:16) or landscape (16:9) frame. */
  width?: number;
  height?: number;
};

export const SAMPLE_PREFIX = "Sample::";
export const MAX_GIG_SAMPLES = 6;
export const MAX_SAMPLE_SECONDS = 90;
export const MAX_SAMPLE_CAPTION = 120;

export const isSampleLine = (line: unknown) => String(line ?? "").toLowerCase().startsWith("sample::");

/** Only plain http(s) URLs ever reach a `src` (no javascript:, data:, blob: etc. from stored data). */
export function isSafeMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const num = (value: unknown, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 10) / 10 : undefined;
};

/** Normalises untrusted input into a sample, or null if it has no usable video URL. */
export function sanitizeGigSample(raw: unknown): GigSample | null {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isSafeMediaUrl(v.url)) return null;
  const caption = typeof v.caption === "string" ? v.caption.replace(/\s+/g, " ").trim().slice(0, MAX_SAMPLE_CAPTION) : "";
  return {
    url: v.url,
    ...(caption ? { caption } : {}),
    ...(isSafeMediaUrl(v.poster) ? { poster: v.poster } : {}),
    ...(num(v.duration, 3600) ? { duration: num(v.duration, 3600) } : {}),
    ...(num(v.width, 10000) && num(v.height, 10000) ? { width: num(v.width, 10000), height: num(v.height, 10000) } : {}),
  };
}

export function encodeGigSample(sample: GigSample) {
  const clean = sanitizeGigSample(sample);
  return clean ? `${SAMPLE_PREFIX}${JSON.stringify(clean)}` : null;
}

/** Reads samples from a gig's requirements, in order. Accepts JSON lines and bare URLs (`Sample::https://…`). */
export function parseGigSamples(requirements: unknown): GigSample[] {
  if (!Array.isArray(requirements)) return [];
  const out: GigSample[] = [];
  for (const line of requirements) {
    if (!isSampleLine(line)) continue;
    const body = String(line).slice(SAMPLE_PREFIX.length).trim();
    let parsed: unknown = null;
    if (body.startsWith("{")) {
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = null;
      }
    } else {
      parsed = { url: body };
    }
    const sample = sanitizeGigSample(parsed);
    if (sample && !out.some((s) => s.url === sample.url)) out.push(sample);
    if (out.length >= MAX_GIG_SAMPLES) break;
  }
  return out;
}

export const sampleIsVertical = (sample: GigSample) => !sample.width || !sample.height || sample.height >= sample.width;

export function formatSampleDuration(seconds?: number) {
  if (!seconds) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
