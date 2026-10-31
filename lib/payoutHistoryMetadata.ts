import { canonicalInstagramReelUrl } from "./socialAnalytics";

type WorkHistorySource = { title?: unknown; submission?: unknown; review?: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Public reel links only; rebuild supported URLs so tracking parameters and redirects cannot leak into history. */
export function safePayoutReelUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const instagram = canonicalInstagramReelUrl(value);
  if (instagram) return instagram;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const id = host === "youtu.be" && parts.length === 1 ? parts[0]
      : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)
        ? parts.length === 2 && parts[0] === "shorts" ? parts[1] : url.pathname === "/watch" ? url.searchParams.get("v") : undefined
        : undefined;
    return id && /^[\w-]{6,64}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : undefined;
  } catch { return undefined; }
}

/** Only the owner-scoped ledger's trusted reel references can be looked up for a public link. */
export function payoutHistoryPostId(workItem: WorkHistorySource): string | undefined {
  const candidate = object(workItem.submission).postId ?? object(workItem.review).postId;
  return typeof candidate === "string" && uuid.test(candidate) ? candidate : undefined;
}

/** Whitelist readable history fields; review notes, credentials and internal identifiers stay server-side. */
export function payoutHistoryMetadata(workItem: WorkHistorySource | undefined, postUrl?: unknown) {
  const rawTitle = typeof workItem?.title === "string" ? workItem.title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  const titleIsId = uuid.test(rawTitle) || /^(?:VIEW|REEL)-[0-9a-f-]{36}$/i.test(rawTitle);
  return {
    workItemTitle: rawTitle && !titleIsId ? rawTitle.slice(0, 180) : undefined,
    reelUrl: safePayoutReelUrl(postUrl) ?? safePayoutReelUrl(object(workItem?.submission).reelUrl),
  };
}
