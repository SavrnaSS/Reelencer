import "server-only";
import { accountPlatformFor, isPlatformProfileUrl, readStoredAccountSetup } from "@/lib/accountSetup";
import { ApiError, databaseError } from "@/lib/api/errors";
import { decodeWorkerName, resolveNotificationContext, sendLifecycleNotification, type MailStatus } from "@/lib/api/gigApplications";
import { emailBaseUrl } from "@/lib/email/send";
import { runScheduledSocialSync, syncAccount, syncAvailability, syncStale } from "@/lib/api/socialSync";
import { storedSyncState } from "@/lib/socialSyncSchedule";
import { resolveSyncConfig, type SyncConfig } from "@/lib/api/integrations";
import { linkSocialAccount } from "@/lib/api/socialLink";
import { openRequestCount } from "@/lib/api/accountRequests";
import { fetchInstagramReel, type ProfilePost } from "@/lib/api/instagramProfile";
import { canonicalInstagramReelUrl, externalPostId, STALE_AFTER_DAYS, SYNC_COOLDOWN_MINUTES, SYNC_STALE_HOURS, type LinkedSocialAccount, type SyncState, type SocialAccountStatus, type SocialPost, type SocialPostStatus, type SocialSnapshot } from "@/lib/socialAnalytics";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readProfileHealth } from "@/lib/accountProfileHealth";
import { countedReels, reelTracking, trackingStartLabel } from "@/lib/reelTracking";
import { profileRecoveryCode } from "./accountProfileRecovery";
import { readSocialPostWalletCredit, readSocialAccountWalletCredits } from "@/lib/socialWallet";

type Row = Record<string, unknown>;
type Sb = ReturnType<typeof supabaseAdmin>;

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);

const toSnapshot = (r: Row): SocialSnapshot => ({
  id: String(r.id),
  capturedAt: String(r.captured_at),
  periodDays: Number(r.period_days ?? 7),
  followers: num(r.followers),
  following: num(r.following),
  posts: num(r.posts),
  reach: num(r.reach),
  impressions: num(r.impressions),
  profileViews: num(r.profile_views),
  engagements: num(r.engagements),
  linkClicks: num(r.link_clicks),
  source: r.source === "api" || r.source === "screenshot" || r.source === "profile" ? r.source : "manual",
  note: str(r.note),
});

const toPost = (r: Row): SocialPost => ({
  id: String(r.id),
  url: String(r.url),
  caption: str(r.caption),
  postedAt: str(r.posted_at),
  views: num(r.views),
  viewsCapturedAt: str(r.views_captured_at),
  viewsSource: ["manual", "profile", "api", "screenshot"].includes(String(r.views_source)) ? r.views_source as SocialPost["source"] : undefined,
  reach: num(r.reach),
  likes: num(r.likes),
  comments: num(r.comments),
  shares: num(r.shares),
  saves: num(r.saves),
  updatedAt: String(r.updated_at),
  // Before the review migration every reel was team-added, i.e. approved.
  status: (["submitted", "approved", "rejected"].includes(String(r.status)) ? r.status : "approved") as SocialPostStatus,
  submittedByWorker: r.submitted_by_worker === true,
  reviewNote: str(r.review_note),
  reviewedAt: str(r.reviewed_at),
  createdAt: String(r.created_at ?? r.updated_at),
  source: r.source === "api" || r.source === "screenshot" || r.source === "profile" ? r.source : "manual",
  ...(r.wallet_credit ? { walletCredit: readSocialPostWalletCredit(r.wallet_credit) } : {}),
  ...(r.removed_at ? { removedAt: String(r.removed_at), removalReason: str(r.removal_reason), ...(r.removal_silent ? { removedSilently: true } : {}) } : {}),
});

const toSync = (r: Row, config: SyncConfig): SyncState => {
  const availability = syncAvailability(String(r.platform), config);
  return {
    ...storedSyncState(r, availability.available),
    ...(!availability.available ? availability : {}),
  };
};

/** Postgres "undefined column": the review migration (202610080002) hasn't been applied yet. */
// Postgres reports an unknown column as 42703; PostgREST rejects it from its schema cache as PGRST204.
const MISSING_COLUMN = "42703";
const missingColumn = (code?: string) => code === MISSING_COLUMN || code === "PGRST204";

/**
 * Self-healing link step: approvals link accounts as they happen, but an approval made before the migration was
 * applied (or one whose link failed) is linked here the next time the creator opens their dashboard.
 */
async function linkMissing(sb: Sb, aliases: string[]) {
  if (!aliases.length) return;
  const { data: apps, error } = await sb.from("gig_applications").select("id,gig_id,worker_code,worker_name,status").in("worker_code", aliases).eq("status", "Accepted");
  databaseError(error);
  const verified = (apps ?? [])
    .map((row) => ({ row, setup: readStoredAccountSetup(decodeWorkerName(row.worker_name).proposal?.accountSetup) }))
    .filter((item) => item.setup?.status === "Verified");
  if (!verified.length) return;
  const { data: linked, error: linkedError } = await sb.from("linked_social_accounts").select("application_id").in("application_id", verified.map((v) => String(v.row.id)));
  databaseError(linkedError);
  const have = new Set((linked ?? []).map((r) => String(r.application_id)));
  for (const item of verified) {
    if (have.has(String(item.row.id)) || !item.setup) continue;
    await linkSocialAccount(sb, { applicationId: String(item.row.id), gigId: String(item.row.gig_id), workerCode: String(item.row.worker_code), setup: item.setup });
  }
}

/**
 * Creators only ever receive reels from the day their account was linked: earlier reels aren't tracked or paid, so
 * they're left out of everything the creator sees (lists, charts, totals). Admins get every reel to audit.
 */
type Audience = "creator" | "admin";

async function hydrate(sb: Sb, rows: Row[], audience: Audience): Promise<LinkedSocialAccount[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  const gigIds = [...new Set(rows.map((r) => String(r.gig_id)))];
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const loadPosts = async () => {
    const data: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const page = await sb.from("social_account_posts").select("*").in("account_id", ids)
        .order("posted_at", { ascending: false, nullsFirst: false }).order("id").range(from, from + 999);
      databaseError(page.error);
      data.push(...(page.data ?? []));
      if ((page.data?.length ?? 0) < 1000) return { data, error: null };
    }
  };
  const [snapshots, posts, gigs] = await Promise.all([
    // Apply the database's row cap to the newest readings, then restore chronological chart order below.
    sb.from("social_account_snapshots").select("*").in("account_id", ids).gte("captured_at", since).order("captured_at", { ascending: false }).order("created_at", { ascending: false }).limit(5000),
    loadPosts(),
    sb.from("gigs").select("id,title,company,payout,payout_type").in("id", gigIds),
  ]);
  databaseError(snapshots.error);
  databaseError(posts.error);
  databaseError(gigs.error);
  const wallet = await sb.rpc("social_post_wallet_state", { p_posts: posts.data.map(post => String(post.id)), p_accounts: ids });
  // An older deployment may show clearly labelled estimates until its read-model migration is installed.
  if (wallet.error && !["PGRST202", "42883"].includes(wallet.error.code ?? "")) databaseError(wallet.error);
  const postWallet = new Map<string, Row>((wallet.data?.posts ?? []).map((state: Row) => [String(state.postId), state]));
  const accountWallet = new Map<string, Row>((wallet.data?.accounts ?? []).map((state: Row) => [String(state.accountId), state]));
  const gigById = new Map((gigs.data ?? []).map((g) => [String(g.id), g as Row]));
  const config = await resolveSyncConfig();
  return rows.map((r) => {
    const gig = gigById.get(String(r.gig_id));
    const profileHealth = readProfileHealth(r.profile_health);
    return {
      id: String(r.id),
      applicationId: String(r.application_id),
      gigId: String(r.gig_id),
      gigTitle: str(gig?.title),
      company: str(gig?.company),
      workerCode: String(r.worker_code),
      platform: String(r.platform),
      handle: String(r.handle),
      profileUrl: String(r.profile_url ?? ""),
      status: (["active", "paused", "unlinked"].includes(String(r.status)) ? r.status : "active") as SocialAccountStatus,
      ...(profileHealth ? { profileHealth: { ...profileHealth, ...(profileHealth.status === "missing" ? { verifyCode: profileRecoveryCode(r) } : {}) } } : {}),
      linkedAt: String(r.linked_at),
      payout: str(gig?.payout),
      payoutType: str(gig?.payout_type),
      ...(accountWallet.has(String(r.id)) ? { walletCredits: readSocialAccountWalletCredits({ amountINR: accountWallet.get(String(r.id))?.creditedINR, reels: accountWallet.get(String(r.id))?.creditedReels }) } : {}),
      sync: toSync(r, config),
      snapshots: (snapshots.data ?? []).filter((s) => String(s.account_id) === String(r.id)).reverse().map(toSnapshot),
      posts: (() => {
        const own = (posts.data ?? []).filter((p) => String(p.account_id) === String(r.id)).map(post => toPost({ ...post, wallet_credit: postWallet.get(String(post.id)) }));
        return audience === "creator" ? countedReels(own, String(r.linked_at)) : own;
      })(),
    };
  });
}

/** A creator's linked accounts (unlinked ones are hidden from them). */
export async function listCreatorAccounts(aliases: string[], sync = false): Promise<{ accounts: LinkedSocialAccount[]; accountIssues?: LinkedSocialAccount[]; statsEnabled: boolean; screenshotReader: boolean }> {
  const sb = supabaseAdmin();
  const screenshotReader = !!(await resolveSyncConfig()).anthropicApiKey;
  try {
    await linkMissing(sb, aliases);
    const load = async () => {
      const { data, error } = await sb.from("linked_social_accounts").select("*").in("worker_code", aliases.length ? aliases : ["__none__"]).order("linked_at", { ascending: false });
      databaseError(error);
      return ((data ?? []) as Row[]).filter(row => row.status !== "unlinked" || readProfileHealth(row.profile_health)?.status === "missing");
    };
    let rows = await load();
    if (sync) {
      const result = await syncStale(sb, rows, SYNC_STALE_HOURS * 3_600_000, 9_000);
      if (result.due) rows = await load();
    }
    const hydrated = await hydrate(sb, rows, "creator");
    return { accounts: hydrated.filter(account => account.status !== "unlinked"), accountIssues: hydrated.filter(account => account.status === "unlinked"), statsEnabled: true, screenshotReader };
  } catch (error) {
    // Linked-account tables not migrated yet: still show every verified account (without stats) instead of an error.
    if (error instanceof ApiError && error.code === "schema_outdated") return { accounts: await verifiedAccountsFromApplications(sb, aliases), statsEnabled: false, screenshotReader: false };
    throw error;
  }
}

/** Verified Content Posting accounts read straight from the creator's approved applications. */
async function verifiedAccountsFromApplications(sb: Sb, aliases: string[]): Promise<LinkedSocialAccount[]> {
  if (!aliases.length) return [];
  const { data: apps, error } = await sb.from("gig_applications").select("id,gig_id,worker_code,worker_name,status,decided_at").in("worker_code", aliases).eq("status", "Accepted");
  databaseError(error);
  const verified = (apps ?? [])
    .map((row) => ({ row, setup: readStoredAccountSetup(decodeWorkerName(row.worker_name).proposal?.accountSetup) }))
    .filter((item) => item.setup?.status === "Verified");
  if (!verified.length) return [];
  const { data: gigs, error: gigError } = await sb.from("gigs").select("id,title,company,payout,payout_type").in("id", [...new Set(verified.map((v) => String(v.row.gig_id)))]);
  databaseError(gigError);
  const gigById = new Map((gigs ?? []).map((g) => [String(g.id), g as Row]));
  return verified.map(({ row, setup }) => {
    const gig = gigById.get(String(row.gig_id));
    return {
      id: `application-${String(row.id)}`,
      applicationId: String(row.id),
      gigId: String(row.gig_id),
      gigTitle: str(gig?.title),
      company: str(gig?.company),
      workerCode: String(row.worker_code),
      platform: setup?.platform || "Social",
      handle: setup?.handle ?? "",
      profileUrl: setup?.profileUrl ?? "",
      status: "active",
      linkedAt: String(setup?.reviewedAt ?? row.decided_at ?? new Date().toISOString()),
      payout: str(gig?.payout),
      payoutType: str(gig?.payout_type),
      sync: { available: false, status: "pending" },
      snapshots: [],
      posts: [],
    };
  });
}

/** Every linked account, for the admin console. */
export async function listAllAccounts(sync = false) {
  const sb = supabaseAdmin();
  const load = async () => {
    const { data, error } = await sb.from("linked_social_accounts").select("*").order("linked_at", { ascending: false }).limit(500);
    databaseError(error);
    return (data ?? []) as Row[];
  };
  let rows = await load();
  if (sync) {
    const result = await syncStale(sb, rows, SYNC_STALE_HOURS * 3_600_000, 9_000);
    if (result.synced || result.failed) rows = await load();
  }
  return hydrate(sb, rows, "admin");
}

async function requireAccount(sb: Sb, accountId: string) {
  const { data, error } = await sb.from("linked_social_accounts").select("id,status,handle,linked_at").eq("id", accountId).maybeSingle();
  databaseError(error);
  if (!data) throw new ApiError(404, "Linked account not found.");
  return data as Row;
}

export type SnapshotInput = {
  accountId: string;
  capturedAt?: string;
  periodDays: number;
  followers?: number;
  following?: number;
  posts?: number;
  reach?: number;
  impressions?: number;
  profileViews?: number;
  engagements?: number;
  linkClicks?: number;
  note?: string;
};

export async function recordSnapshot(actorId: string, input: SnapshotInput) {
  const sb = supabaseAdmin();
  await requireAccount(sb, input.accountId);
  const metrics = [input.followers, input.following, input.posts, input.reach, input.impressions, input.profileViews, input.engagements, input.linkClicks];
  if (metrics.every((v) => v === undefined)) throw new ApiError(400, "Enter at least one number.", "invalid_input");
  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
  if (Number.isNaN(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 5 * 60_000) throw new ApiError(400, "The check-in date can't be in the future.", "invalid_input");
  const { data, error } = await sb
    .from("social_account_snapshots")
    .insert({
      account_id: input.accountId,
      captured_at: capturedAt.toISOString(),
      period_days: input.periodDays,
      followers: input.followers ?? null,
      following: input.following ?? null,
      posts: input.posts ?? null,
      reach: input.reach ?? null,
      impressions: input.impressions ?? null,
      profile_views: input.profileViews ?? null,
      engagements: input.engagements ?? null,
      link_clicks: input.linkClicks ?? null,
      note: input.note?.trim() ?? "",
      source: "manual",
      recorded_by: actorId,
    })
    .select("*")
    .single();
  databaseError(error);
  return toSnapshot(data as Row);
}

export async function deleteSnapshot(id: string) {
  const { error } = await supabaseAdmin().from("social_account_snapshots").delete().eq("id", id);
  databaseError(error);
}

export type PostInput = {
  accountId: string;
  /** Omitted: new reels are approved (team-added), existing ones keep their review state. */
  status?: SocialPostStatus;
  url: string;
  caption?: string;
  postedAt?: string;
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
};

/** Adds a reel, or updates its numbers when the same link is entered again. */
export async function upsertPost(actorId: string, input: PostInput) {
  const sb = supabaseAdmin();
  const account = await requireAccount(sb, input.accountId);
  const postedAt = input.postedAt ? new Date(input.postedAt) : null;
  if (postedAt && Number.isNaN(postedAt.getTime())) throw new ApiError(400, "Invalid post date.", "invalid_input");
  if (postedAt) assertInWindow(postedAt.toISOString(), account);
  const { data: current } = await sb.from("social_account_posts").select("removed_at").eq("account_id", input.accountId).eq("url", input.url.trim()).maybeSingle();
  if (current?.removed_at) throw new ApiError(409, "This reel was removed. Restore it from the Removed tab instead.", "reel_removed");
  const { data, error } = await sb.rpc("save_social_post_with_wallet", {
    p_actor: actorId,
    p_input: {
      account_id: input.accountId, url: input.url.trim(), caption: input.caption?.trim() ?? "",
      posted_at: postedAt?.toISOString() ?? null, views: input.views ?? null,
      views_captured_at: input.views !== undefined ? new Date().toISOString() : null,
      views_source: input.views !== undefined ? "manual" : null,
      reach: input.reach ?? null, likes: input.likes ?? null, comments: input.comments ?? null,
      shares: input.shares ?? null, saves: input.saves ?? null,
      ...(input.status ? { status: input.status } : {}),
    },
  });
  requireWalletCreditSchema(error);
  databaseError(error);
  if (!data?.post) throw new ApiError(503, "The reel could not be saved. Refresh and try again.", "wallet_credit_unavailable");
  return hydratedWalletPost(sb, data.post as Row);
}


async function hydratedWalletPost(sb: Sb, post: Row) {
  const { data, error } = await sb.rpc("social_post_wallet_state", { p_posts: [String(post.id)], p_accounts: [String(post.account_id)] });
  databaseError(error);
  return toPost({ ...post, wallet_credit: data?.posts?.[0] });
}

/** Approvals must never succeed without the matching wallet transaction being installed. */
function requireWalletCreditSchema(error: { code?: string } | null) {
  if (["PGRST202", "42883", "42703", "PGRST204"].includes(error?.code ?? "")) {
    throw new ApiError(503, "Approved earnings need the latest wallet database update. Please contact the team or try again after the update.", "schema_outdated");
  }
}

/**
 * Removes a reel from Reelencer. The row stays as a tombstone (who, when, why) so sync and creator resubmissions
 * can't bring it back; removed reels are always 'rejected', so they're never approved, waiting or paid, and creators
 * never receive them. Reports pending view claims that cite the reel, since those can no longer be approved.
 */
export async function removePost(actorId: string, id: string, reason?: string, silent = false) {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("social_account_posts")
    .update({ status: "rejected", removed_at: now, removed_by: actorId, removal_reason: reason?.trim() ?? "", removal_silent: silent, review_note: "", reviewed_at: now, updated_at: now })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (missingColumn(error?.code)) throw new ApiError(503, "Reel removal needs the database updates 202610290002_reel_removal.sql and 202610290003_silent_reel_removal.sql. Apply them in Supabase, then try again.", "schema_outdated");
  databaseError(error);
  if (!data) throw new ApiError(404, "Reel not found.");
  const { data: claimRows, error: claimError } = await sb.from("view_payout_claim_items").select("claim_id,view_payout_claims!inner(status)").eq("post_id", id).eq("view_payout_claims.status", "Pending");
  // Older databases without view claims simply have none pending.
  const pendingClaims = claimError ? 0 : new Set((claimRows ?? []).map((row) => String(row.claim_id))).size;
  const post = toPost(data as Row);
  // A silent removal leaves no trace for the creator, so only the announced kind sends an email.
  const mailStatus = silent ? null : await notifyReelRemoved(sb, String(data.account_id), post, reason);
  return { post, pendingClaims, mailStatus };
}

/** Brings a removed reel back. It returns to review rather than to its old state, so it's checked again. */
export async function restorePost(id: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin()
    .from("social_account_posts")
    .update({ removed_at: null, removed_by: null, removal_reason: "", removal_silent: false, status: "submitted", review_note: "", reviewed_at: null, updated_at: now })
    .eq("id", id)
    .not("removed_at", "is", null)
    .select("*")
    .maybeSingle();
  databaseError(error);
  if (!data) throw new ApiError(404, "Removed reel not found.");
  return toPost(data as Row);
}

const REMOVED_MESSAGE = "The team removed this reel, so it can't be added again.";
const DUPLICATE_MESSAGE = "This reel has already been added.";

export async function setAccountStatus(accountId: string, status: SocialAccountStatus) {
  const sb = supabaseAdmin();
  const { data: account, error: readError } = await sb.from("linked_social_accounts").select("*").eq("id", accountId).maybeSingle();
  databaseError(readError);
  if (!account) throw new ApiError(404, "Account not found.");
  if (status !== "unlinked" && readProfileHealth(account.profile_health)?.status === "missing") throw new ApiError(409, "Verify the recovery code before linking this profile again.");
  const { error } = await sb.from("linked_social_accounts").update({ status, updated_at: new Date().toISOString(), ...(status === "active" ? { next_sync_at: new Date().toISOString() } : {}) }).eq("id", accountId);
  databaseError(error);
}

/** Reels from before the account was linked are never tracked; say which day counts from. */
function assertInWindow(postedAt: string, account: Row) {
  if (reelTracking(postedAt, String(account.linked_at)) !== "before_link") return;
  const since = trackingStartLabel(String(account.linked_at));
  throw new ApiError(409, `This reel went live before @${String(account.handle)} was linked. Only reels posted from ${since} count.`, "reel_before_link");
}

async function requireCreatorAccount(sb: Sb, accountId: string, aliases: string[]) {
  const { data, error } = await sb.from("linked_social_accounts").select("id,status,platform,handle,worker_code,linked_at").eq("id", accountId).maybeSingle();
  databaseError(error);
  if (!data || !aliases.includes(String(data.worker_code))) throw new ApiError(404, "Linked account not found.");
  return data as Row;
}

const MAX_PENDING_REELS = 30;

/** Save a reported reel with verified public metrics, reusing its existing review record on retries. */
export async function submitCreatorReel(aliases: string[], input: { accountId: string; url: string; caption?: string; postedAt?: string }) {
  const sb = supabaseAdmin();
  const account = await requireCreatorAccount(sb, input.accountId, aliases);
  if (account.status !== "active") throw new ApiError(409, "This account is paused. Check with the team before posting.");
  const platform = accountPlatformFor(String(account.platform));
  const url = platform.id === "instagram" ? canonicalInstagramReelUrl(input.url) : input.url.trim();
  if (!url) throw new ApiError(400, "Paste the Instagram reel link from its Share menu.", "invalid_input");
  if (!isPlatformProfileUrl(url, platform) || !/^https:\/\//i.test(url)) throw new ApiError(400, `Paste the reel's ${platform.label} link (https://…).`, "invalid_input");
  const postedAt = input.postedAt ? new Date(input.postedAt) : new Date();
  if (Number.isNaN(postedAt.getTime()) || postedAt.getTime() > Date.now() + 86_400_000) throw new ApiError(400, "Choose the day the reel went live.", "invalid_input");
  const externalId = externalPostId(url);
  const loadPosts = async () => {
    const { data, error } = await sb.from("social_account_posts").select("*").eq("account_id", input.accountId);
    databaseError(error);
    return (data ?? []) as Row[];
  };
  const findExisting = (posts: Row[]) => posts.find(post => String(post.url) === url || (!!externalId && (post.external_id === externalId || externalPostId(String(post.url)) === externalId)));
  const posts = await loadPosts();
  const existing = findExisting(posts);
  if (existing?.removed_at) {
    // Silently removed: answer exactly like a link that's already been added, so nothing hints at a removal.
    if (existing.removal_silent) throw new ApiError(409, DUPLICATE_MESSAGE, "conflict");
    throw new ApiError(409, existing.removal_reason ? `${REMOVED_MESSAGE} Reason: ${String(existing.removal_reason)}` : REMOVED_MESSAGE, "reel_removed");
  }
  if (!existing && posts.filter(post => post.status === "submitted").length >= MAX_PENDING_REELS) throw new ApiError(429, "You have a lot of reels waiting for review. Try again once the team catches up.");

  let fetched: ProfilePost | undefined;
  if (platform.id === "instagram") {
    // A blocked/publicly unavailable read must not lose the creator's submission or saved metrics.
    try { fetched = await fetchInstagramReel(String(account.handle), url); } catch { /* Retry on the next visible account sync. */ }
  }
  const hasStats = !!fetched && [fetched.views, fetched.likes, fetched.comments].some(value => value !== undefined);
  const measuredAt = new Date().toISOString();
  const metrics = {
    ...(fetched?.views !== undefined ? { views: fetched.views, views_captured_at: measuredAt, views_source: "profile" } : {}),
    ...(fetched?.likes !== undefined ? { likes: fetched.likes } : {}),
    ...(fetched?.comments !== undefined ? { comments: fetched.comments } : {}),
  };
  const result = (post: Row, alreadyAdded: boolean) => ({
    post: toPost(post),
    alreadyAdded,
    message: alreadyAdded
      ? hasStats ? "This reel is already tracked. Its public stats have been refreshed." : "This reel is already tracked. Its saved stats are unchanged."
      : hasStats ? "Reel added with its latest public stats. Awaiting the team's review."
        : platform.id === "instagram" ? "Reel saved for review. Public stats aren't available yet; automatic sync will retry."
          : "Reel sent for review. Its stats will appear when available.",
  });
  const refreshExisting = async (post: Row) => {
    if (!hasStats && !fetched?.postedAt && !fetched?.caption) return result(post, true);
    const { data, error } = await sb.from("social_account_posts").update({
      ...metrics,
      ...(fetched?.postedAt ? { posted_at: fetched.postedAt } : {}),
      ...(!post.caption && fetched?.caption ? { caption: fetched.caption } : {}),
      updated_at: measuredAt,
    }).eq("id", String(post.id)).select("*").single();
    databaseError(error);
    return result(data as Row, true);
  };
  // Checked before reusing a saved record too, so a pre-link reel is never handed back to the creator.
  assertInWindow(fetched?.postedAt ?? (existing?.posted_at ? String(existing.posted_at) : postedAt.toISOString()), account);
  if (existing) return refreshExisting(existing);

  const { data, error } = await sb
    .from("social_account_posts")
    .insert({
      account_id: input.accountId,
      url,
      caption: fetched?.caption || input.caption?.trim() || "",
      posted_at: fetched?.postedAt ?? postedAt.toISOString(),
      status: "submitted",
      submitted_by_worker: true,
      source: hasStats ? "profile" : "manual",
      ...(externalId ? { external_id: externalId } : {}),
      ...metrics,
    })
    .select("*")
    .single();
  if (error?.code === "23505") {
    // Automatic discovery or another tab may have inserted it during the public read.
    const concurrent = findExisting(await loadPosts());
    if (concurrent) return refreshExisting(concurrent);
    throw new ApiError(409, DUPLICATE_MESSAGE, "conflict");
  }
  if (error?.code === MISSING_COLUMN) throw new ApiError(503, "Reel submissions aren't switched on yet.", "schema_outdated");
  databaseError(error);
  return result(data as Row, false);
}

/** Creators can take back a reel the team hasn't reviewed yet (wrong link, deleted post). */
export async function withdrawCreatorReel(aliases: string[], postId: string) {
  const sb = supabaseAdmin();
  const { data: post, error } = await sb.from("social_account_posts").select("id,account_id,status").eq("id", postId).maybeSingle();
  databaseError(error);
  if (!post) throw new ApiError(404, "Reel not found.");
  await requireCreatorAccount(sb, String(post.account_id), aliases);
  if (post.status !== "submitted") throw new ApiError(409, "Reviewed reels can't be withdrawn. Message the team instead.");
  const { error: deleteError } = await sb.from("social_account_posts").delete().eq("id", postId).eq("status", "submitted");
  databaseError(deleteError);
}

export async function reviewPost(actorId: string, postId: string, status: "approved" | "rejected", note?: string) {
  const sb = supabaseAdmin();
  if (status === "approved") {
    const { data, error } = await sb.rpc("approve_social_post_and_credit", { p_actor: actorId, p_post: postId, p_note: note?.trim() ?? "" });
    requireWalletCreditSchema(error);
    databaseError(error);
    if (!data?.post) throw new ApiError(503, "The approval could not be confirmed. Refresh and try again.", "wallet_credit_unavailable");
    return { post: await hydratedWalletPost(sb, data.post as Row), mailStatus: null };
  }
  const { data, error } = await sb
    .from("social_account_posts")
    .update({ status, review_note: note?.trim() ?? "", reviewed_at: new Date().toISOString(), updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("id", postId)
    .select("*")
    .maybeSingle();
  if (error?.code === MISSING_COLUMN) throw new ApiError(503, "Run the latest database migration to review reels.", "schema_outdated");
  databaseError(error);
  if (!data) throw new ApiError(404, "Reel not found.");
  const post = toPost(data as Row);
  // Rejections need the creator to act (re-post, fix the link), so they get an email; approvals show in the dashboard.
  let mailStatus: MailStatus | null = null;
  if (status === "rejected") mailStatus = await notifyReelRejected(sb, String(data.account_id), post, note);
  return { post, mailStatus };
}

async function notifyReelRejected(sb: Sb, accountId: string, post: SocialPost, note?: string): Promise<MailStatus> {
  try {
    const { data: account } = await sb.from("linked_social_accounts").select("application_id,handle,platform").eq("id", accountId).maybeSingle();
    if (!account) return { sent: false, reason: "Account not found." };
    const { data: application } = await sb.from("gig_applications").select("*").eq("id", String(account.application_id)).maybeSingle();
    if (!application) return { sent: false, reason: "Application not found." };
    const { to, context } = await resolveNotificationContext(sb, application as Row);
    return await sendLifecycleNotification(to, context, {
      eyebrow: "Reel Not Approved",
      tone: "warning",
      title: "One of your reels wasn't approved",
      intro: `The team reviewed a reel you posted on @${String(account.handle)} for ${context?.gigTitle ?? "your gig"} and couldn't approve it.`,
      highlights: [
        { label: "Account", value: `@${String(account.handle)}` },
        { label: "Status", value: "Not approved" },
      ],
      sections: [
        { label: "Reel", value: post.caption ? `${post.caption} (${post.url})` : post.url },
        { label: "Team note", value: note?.trim() || "Open your accounts page for details." },
      ],
      ctaLabel: "Open your accounts",
      ctaHref: `${emailBaseUrl()}/dashboard?section=accounts`,
    });
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Notification failed." };
  }
}

async function notifyReelRemoved(sb: Sb, accountId: string, post: SocialPost, reason?: string): Promise<MailStatus> {
  try {
    const { data: account } = await sb.from("linked_social_accounts").select("application_id,handle").eq("id", accountId).maybeSingle();
    if (!account) return { sent: false, reason: "Account not found." };
    const { data: application } = await sb.from("gig_applications").select("*").eq("id", String(account.application_id)).maybeSingle();
    if (!application) return { sent: false, reason: "Application not found." };
    const { to, context } = await resolveNotificationContext(sb, application as Row);
    return await sendLifecycleNotification(to, context, {
      eyebrow: "Reel Removed",
      tone: "warning",
      title: "A reel was removed from your account",
      intro: `The team removed a reel on @${String(account.handle)} from ${context?.gigTitle ?? "your gig"}. It no longer counts towards views or pay, and it can't be added again.`,
      highlights: [
        { label: "Account", value: `@${String(account.handle)}` },
        { label: "Status", value: "Removed" },
      ],
      sections: [
        { label: "Reel", value: post.caption ? `${post.caption} (${post.url})` : post.url },
        { label: "Reason", value: reason?.trim() || "Message the team if you have questions." },
      ],
      ctaLabel: "Open your accounts",
      ctaHref: `${emailBaseUrl()}/dashboard?section=accounts`,
    });
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Notification failed." };
  }
}

/** Cheap counts for the admin tab badge: accounts overdue for a check-in and reels waiting for review. */
export async function accountsSummary() {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000).toISOString();
  const [active, recent, reels] = await Promise.all([
    sb.from("linked_social_accounts").select("id").eq("status", "active").limit(2000),
    sb.from("social_account_snapshots").select("account_id").gte("captured_at", since).limit(5000),
    sb.from("social_account_posts").select("id", { count: "exact", head: true }).eq("status", "submitted"),
  ]);
  databaseError(active.error);
  databaseError(recent.error);
  const fresh = new Set((recent.data ?? []).map((r) => String(r.account_id)));
  const due = (active.data ?? []).filter((a) => !fresh.has(String(a.id))).length;
  const reelsToReview = reels.error ? 0 : (reels.count ?? 0);
  return { due, reelsToReview, accountRequests: await openRequestCount() };
}

/** "Sync now": creators for their own accounts (with a cooldown), admins for any. Returns the refreshed account. */
export async function syncAccountNow(accountId: string, actor: { aliases: string[]; isAdmin: boolean }, audience: Audience = "creator") {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("linked_social_accounts").select("*").eq("id", accountId).maybeSingle();
  databaseError(error);
  if (!data || (!actor.isAdmin && !actor.aliases.includes(String(data.worker_code)))) throw new ApiError(404, "Linked account not found.");
  const row = data as Row;
  if (row.status !== "active") throw new ApiError(409, "Resume this account before syncing its statistics.");
  const availability = syncAvailability(String(row.platform), await resolveSyncConfig());
  if (!availability.available) {
    throw new ApiError(409, availability.status === "unsupported" ? "This platform doesn't offer automatic stats. The team updates them." : "Automatic sync isn't connected yet. The team updates stats meanwhile.");
  }
  const last = row.last_sync_attempt_at ? Date.parse(String(row.last_sync_attempt_at)) : row.last_synced_at ? Date.parse(String(row.last_synced_at)) : 0;
  const waitMs = last + SYNC_COOLDOWN_MINUTES * 60_000 - Date.now();
  if (waitMs > 0 && !(Date.parse(String(row.sync_locked_until)) > Date.now())) throw new ApiError(429, `Checked recently. Try again in ${Math.ceil(waitMs / 1000)} seconds.`, "cooldown");
  if (row.sync_error_code === "rate_limited" && Date.parse(String(row.next_sync_at)) > Date.now()) throw new ApiError(429, "The platform has limited requests. Automatic sync will retry at the scheduled time.", "cooldown");
  await syncAccount(sb, row, undefined, { force: true });
  const { data: fresh, error: freshError } = await sb.from("linked_social_accounts").select("*").eq("id", accountId).maybeSingle();
  databaseError(freshError);
  const [account] = await hydrate(sb, fresh ? [fresh as Row] : [], audience);
  return account;
}

/** Shared by external cron and the optional long-running local scheduler. */
export async function syncAllAccounts() {
  return runScheduledSocialSync();
}

/** An account after a profile recovery step; creators get their view of it (only reels since linking). */
export async function recoveredAccountView(row: Row, audience: Audience = "creator") {
  return (await hydrate(supabaseAdmin(), [row], audience))[0];
}
