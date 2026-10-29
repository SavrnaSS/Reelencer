import "server-only";
import { ApiError } from "@/lib/api/errors";
import { resolveSyncConfig } from "@/lib/api/integrations";
import type { SocialPost, SocialSnapshot } from "@/lib/socialAnalytics";
import { reelTracking } from "@/lib/reelTracking";
import type { supabaseAdmin } from "@/lib/supabaseAdmin";

// AI screenshot reader: turns screenshots the account holder takes inside the app (profile, Professional dashboard,
// reel insights) into numbers. No platform API, no logins: just what the person can see on their own screen.
// The model only transcribes; every value is validated here before anything is stored.

type Sb = ReturnType<typeof supabaseAdmin>;
type Row = Record<string, unknown>;

export type ScreenKind = "profile" | "account_insights" | "reel_insights" | "other";
export type ReelReading = { postedOn?: string; captionHint?: string; views?: number; reach?: number; likes?: number; comments?: number; shares?: number; saves?: number };
export type InsightReading = {
  screens: ScreenKind[];
  handle?: string;
  account: { followers?: number; following?: number; posts?: number; periodDays?: number; reach?: number; impressions?: number; profileViews?: number; engagements?: number; linkClicks?: number };
  reels: ReelReading[];
  confidence: number;
  warnings: string[];
};

export const MAX_SCREENSHOTS = 6;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

const count = { type: "integer", minimum: 0, description: "Exact integer as shown, with K/M/B and locale separators expanded (12.4K → 12400, 1,2 M → 1200000). Omit if not clearly visible." };
const TOOL = {
  name: "record_insights",
  description: "Record the numbers visible in the account holder's screenshots.",
  input_schema: {
    type: "object",
    properties: {
      screens: { type: "array", items: { type: "string", enum: ["profile", "account_insights", "reel_insights", "other"] }, description: "What each screenshot shows, in order." },
      handle: { type: "string", description: "The account username shown on the screen, without @. Omit if not visible." },
      account: {
        type: "object",
        properties: {
          followers: count,
          following: count,
          posts: count,
          period_days: { type: "integer", minimum: 1, maximum: 90, description: "Insights date range in days (\"Last 7 days\" → 7, \"Last 30 days\" → 30)." },
          accounts_reached: count,
          views_or_impressions: count,
          profile_visits: count,
          interactions: { ...count, description: "Accounts engaged or total interactions for the period." },
          link_taps: { ...count, description: "External link taps for the period." },
        },
      },
      reels: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            posted_on: { type: "string", description: "Post date as YYYY-MM-DD if shown or derivable from the given today date." },
            caption_hint: { type: "string", description: "First few words of the caption, if visible." },
            views: count, reach: { ...count, description: "Accounts reached." }, likes: count, comments: count, shares: count, saves: count,
          },
        },
      },
      confidence: { type: "number", minimum: 0, maximum: 1, description: "How legible and unambiguous the numbers were." },
      warnings: { type: "array", items: { type: "string" }, description: "Anything cropped, blurry, ambiguous, or that looks edited." },
    },
    required: ["screens", "confidence"],
  },
} as const;

const SYSTEM = [
  "You transcribe numbers from screenshots of a social media app (Instagram, YouTube, TikTok) taken by the account holder.",
  "Report only numbers that are clearly visible. Never estimate, infer, or fill gaps; omit anything you can't read.",
  "Expand abbreviations exactly: K = thousand, M = million, B = billion, and handle both 1,234 and 1.234 thousands separators.",
  "Profile screens show followers / following / posts. Professional dashboard or Insights screens show accounts reached, views, profile visits, interactions and link taps for a date range.",
  "Reel insight screens show one reel's views (plays), reach, likes, comments, shares and saves.",
  "If the screenshot looks altered or numbers contradict each other, say so in warnings and lower confidence.",
  "Always answer by calling record_insights.",
].join(" ");

const int = (value: unknown) => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 2_000_000_000 ? Math.round(n) : undefined;
};
const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);

/** Validates the model's tool input into a safe reading (pure; exported for tests). */
export function normalizeReading(raw: unknown): InsightReading {
  const v = (raw && typeof raw === "object" ? raw : {}) as Row;
  const a = (v.account && typeof v.account === "object" ? v.account : {}) as Row;
  const days = int(a.period_days);
  const kinds: ScreenKind[] = ["profile", "account_insights", "reel_insights", "other"];
  const date = (value: unknown) => {
    const s = text(value, 20);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined;
  };
  return {
    screens: (Array.isArray(v.screens) ? v.screens : []).filter((s): s is ScreenKind => kinds.includes(s as ScreenKind)).slice(0, MAX_SCREENSHOTS),
    handle: text(v.handle, 120)?.replace(/^@+/, "").toLowerCase(),
    account: {
      followers: int(a.followers),
      following: int(a.following),
      posts: int(a.posts),
      periodDays: days && days >= 1 && days <= 90 ? days : undefined,
      reach: int(a.accounts_reached),
      impressions: int(a.views_or_impressions),
      profileViews: int(a.profile_visits),
      engagements: int(a.interactions),
      linkClicks: int(a.link_taps),
    },
    reels: (Array.isArray(v.reels) ? v.reels : []).slice(0, 10).map((r) => {
      const x = (r && typeof r === "object" ? r : {}) as Row;
      return {
        postedOn: date(x.posted_on),
        captionHint: text(x.caption_hint, 120),
        views: int(x.views),
        reach: int(x.reach),
        likes: int(x.likes),
        comments: int(x.comments),
        shares: int(x.shares),
        saves: int(x.saves),
      };
    }).filter((r) => [r.views, r.reach, r.likes, r.comments, r.shares, r.saves].some((n) => n !== undefined)),
    confidence: typeof v.confidence === "number" && v.confidence >= 0 && v.confidence <= 1 ? v.confidence : 0,
    warnings: (Array.isArray(v.warnings) ? v.warnings : []).map((w) => text(w, 200)).filter((w): w is string => !!w).slice(0, 6),
  };
}

/** Image type from its first bytes (never trust the browser's content type). */
export function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Sends the screenshots to the vision model and returns a validated reading. */
export async function readScreenshots(images: { bytes: Uint8Array; type: string }[], context: { platform: string; handle: string; today?: string }): Promise<InsightReading> {
  const config = await resolveSyncConfig();
  if (!config.anthropicApiKey) throw new ApiError(409, "The screenshot reader isn't connected yet. Ask the team to connect it in Auto-sync.", "not_configured");
  const today = context.today ?? new Date().toISOString().slice(0, 10);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.INSIGHTS_VISION_MODEL || "claude-sonnet-5-5",
        max_tokens: 1500,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [
          {
            role: "user",
            content: [
              ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.type, data: Buffer.from(img.bytes).toString("base64") } })),
              { type: "text", text: `Platform: ${context.platform}. Expected account: @${context.handle}. Today is ${today}. Record what these ${images.length} screenshot(s) show.` },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(504, "Reading the screenshots took too long. Try fewer or smaller images.");
  }
  const body = (await res.json().catch(() => null)) as Row | null;
  if (!res.ok) throw new ApiError(502, `The screenshot reader is unavailable (${res.status}). Try again in a minute.`);
  const toolUse = ((body?.content as Row[] | undefined) ?? []).find((c) => c.type === "tool_use" && c.name === TOOL.name);
  if (!toolUse) throw new ApiError(502, "The screenshots couldn't be read. Try clearer, uncropped screenshots.");
  return normalizeReading(toolUse.input);
}

/** Pairs read reels with tracked reels: by date (±1 day), tie-broken by caption words (pure; exported for tests). */
export function matchReels(reels: ReelReading[], posts: Pick<SocialPost, "id" | "postedAt" | "caption" | "status">[]) {
  const used = new Set<string>();
  const words = (s?: string) => new Set(String(s ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  return reels.map((reel) => {
    const candidates = posts.filter((p) => p.status !== "rejected" && !used.has(p.id));
    const scored = candidates
      .map((p) => {
        const dayGap = reel.postedOn && p.postedAt ? Math.abs(Date.parse(reel.postedOn) - Date.parse(p.postedAt.slice(0, 10))) / 86_400_000 : Infinity;
        const a = words(reel.captionHint);
        const overlap = [...words(p.caption)].filter((w) => a.has(w)).length;
        return { p, score: (dayGap <= 1 ? 10 - dayGap * 3 : 0) + overlap * 2 };
      })
      .filter((x) => x.score >= 4)
      .sort((x, y) => y.score - x.score);
    const best = scored[0]?.p;
    if (best) used.add(best.id);
    return { reel, postId: best?.id };
  });
}

/** Flags readings that are wildly off the previous check-in (likely misread or edited). */
export function suspiciousJump(previousFollowers: number | undefined, followers: number | undefined) {
  if (!previousFollowers || followers === undefined) return false;
  return followers > previousFollowers * 10 + 1000 || followers < previousFollowers / 10 - 1000;
}

export type ApplyResult = { snapshot?: SocialSnapshot; updatedPostIds: string[]; unmatchedReels: number; warnings: string[] };

/**
 * Stores a reading: account numbers become a check-in (source "screenshot"); reel numbers update the matching
 * tracked reels. Reels can't be created from a screenshot (it has no link), so unmatched ones are reported.
 */
export async function applyReading(
  sb: Sb,
  account: Row,
  reading: InsightReading,
  options: { actorId: string; byCreator: boolean; postId?: string; imageCount: number },
): Promise<ApplyResult> {
  const warnings = [...reading.warnings];
  const expected = String(account.handle).toLowerCase();
  if (reading.handle && reading.handle !== expected) {
    throw new ApiError(422, `These screenshots are from @${reading.handle}, not @${account.handle}. Upload screenshots of the linked account.`, "handle_mismatch");
  }
  if (!reading.handle) warnings.push(`The username wasn't visible. Make sure the screenshots are from @${account.handle}.`);
  if (reading.confidence < 0.5) throw new ApiError(422, "The numbers weren't clear enough to trust. Upload sharper, uncropped screenshots.", "low_confidence");

  const id = String(account.id);
  const a = reading.account;
  const hasAccountNumbers = [a.followers, a.following, a.posts, a.reach, a.impressions, a.profileViews, a.engagements, a.linkClicks].some((n) => n !== undefined);
  let snapshot: SocialSnapshot | undefined;
  if (hasAccountNumbers) {
    const { data: prev } = await sb.from("social_account_snapshots").select("followers").eq("account_id", id).not("followers", "is", null).order("captured_at", { ascending: false }).limit(1).maybeSingle();
    const flagged = suspiciousJump(prev?.followers as number | undefined, a.followers);
    if (flagged && options.byCreator) {
      throw new ApiError(422, "Those numbers are far from the last check-in. Double-check the screenshot or ask the team to update it.", "suspicious");
    }
    const note = [
      `Read from ${options.imageCount} screenshot${options.imageCount === 1 ? "" : "s"}`,
      `confidence ${Math.round(reading.confidence * 100)}%`,
      options.byCreator ? "uploaded by creator" : "uploaded by team",
      flagged ? "large jump, verify" : "",
    ].filter(Boolean).join(" · ");
    const row = {
      account_id: id,
      captured_at: new Date().toISOString(),
      period_days: a.periodDays ?? 7,
      followers: a.followers ?? null,
      following: a.following ?? null,
      posts: a.posts ?? null,
      reach: a.reach ?? null,
      impressions: a.impressions ?? null,
      profile_views: a.profileViews ?? null,
      engagements: a.engagements ?? null,
      link_clicks: a.linkClicks ?? null,
      source: "screenshot",
      note: note.slice(0, 500),
      recorded_by: options.actorId,
    };
    const { data, error } = await sb.from("social_account_snapshots").insert(row).select("*").single();
    if (error?.code === "23514") throw new ApiError(503, "Run the latest database migration to save screenshot readings.", "schema_outdated");
    if (error) throw new ApiError(503, "The reading couldn't be saved. Try again.");
    snapshot = {
      id: String(data.id),
      capturedAt: String(data.captured_at),
      periodDays: Number(data.period_days),
      followers: a.followers,
      following: a.following,
      posts: a.posts,
      reach: a.reach,
      impressions: a.impressions,
      profileViews: a.profileViews,
      engagements: a.engagements,
      linkClicks: a.linkClicks,
      source: "screenshot",
      note,
    };
  }

  const updatedPostIds: string[] = [];
  let unmatchedReels = 0;
  if (reading.reels.length) {
    const { data: postRows } = await sb.from("social_account_posts").select("*").eq("account_id", id);
    // Reels from before the account was linked aren't tracked, so screenshots never update them.
    const posts = (postRows ?? [])
      .filter((p) => !p.removed_at)
      .map((p) => ({ id: String(p.id), postedAt: p.posted_at ? String(p.posted_at) : undefined, caption: String(p.caption ?? ""), status: String(p.status ?? "approved") as SocialPost["status"] }))
      .filter((p) => reelTracking(p.postedAt, String(account.linked_at ?? "")) !== "before_link");
    const pairs = options.postId
      ? [{ reel: reading.reels[0], postId: posts.some((p) => p.id === options.postId) ? options.postId : undefined }]
      : matchReels(reading.reels, posts);
    for (const { reel, postId } of pairs) {
      if (!postId) {
        unmatchedReels += 1;
        continue;
      }
      const update = Object.fromEntries(
        Object.entries({ views: reel.views, reach: reel.reach, likes: reel.likes, comments: reel.comments, shares: reel.shares, saves: reel.saves }).filter(([, n]) => n !== undefined),
      );
      const { error } = await sb.from("social_account_posts").update({ ...update, ...(reel.views !== undefined ? { views_captured_at: new Date().toISOString(), views_source: "screenshot" } : {}), updated_at: new Date().toISOString() }).eq("id", postId).eq("account_id", id);
      if (!error) updatedPostIds.push(postId);
    }
    if (unmatchedReels) warnings.push(`${unmatchedReels} reel${unmatchedReels === 1 ? "" : "s"} couldn't be matched to a tracked reel. Submit the reel's link first, then use “Update from screenshot” on it.`);
  }
  if (!snapshot && !updatedPostIds.length) {
    throw new ApiError(422, unmatchedReels ? warnings.at(-1)! : "No insight numbers were found. Screenshot the profile, the Professional dashboard, or a reel's insights.", "nothing_found");
  }
  return { snapshot, updatedPostIds, unmatchedReels, warnings };
}

