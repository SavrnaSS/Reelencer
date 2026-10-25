import "server-only";
import { fetchInstagramProfile } from "@/lib/api/instagramProfile";
import { fetchInstagramBusinessProfile } from "@/lib/api/instagramGraph";
import { syncInterval } from "@/lib/socialSyncSchedule";
import { ApiError, databaseError } from "@/lib/api/errors";
import { decryptSecretText, encryptSecretText } from "@/lib/secretCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Credentials for the linked-account auto-sync. Environment variables win (ops can pin them); otherwise admins set
// them from the console and they're stored encrypted in `integration_settings`. Values never leave the server: the
// console only ever sees a short hint ("…k9Qz").

export const SYNC_SETTING_KEYS = {
  youtubeApiKey: { key: "youtube.api_key", env: "YOUTUBE_API_KEY" },
  metaAccessToken: { key: "meta.access_token", env: "META_GRAPH_ACCESS_TOKEN" },
  metaIgBusinessId: { key: "meta.ig_business_id", env: "META_IG_BUSINESS_ACCOUNT_ID" },
  // AI screenshot reader (reads numbers from insight screenshots; no platform API involved).
  anthropicApiKey: { key: "anthropic.api_key", env: "ANTHROPIC_API_KEY" },
} as const;
export type SyncSettingName = keyof typeof SYNC_SETTING_KEYS;

export type SyncConfig = {
  youtubeApiKey: string;
  metaAccessToken: string;
  metaIgBusinessId: string;
  anthropicApiKey: string;
  source: Record<SyncSettingName, "env" | "app" | "none">;
};

const TTL_MS = 60_000;
let cache: { at: number; values: Partial<Record<SyncSettingName, { value: string; hint: string }>> } | null = null;

async function loadStored(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const values: Partial<Record<SyncSettingName, { value: string; hint: string }>> = {};
  try {
    const keys = Object.values(SYNC_SETTING_KEYS).map((s) => s.key);
    const { data, error } = await supabaseAdmin().from("integration_settings").select("key,value_enc,hint").in("key", keys);
    if (!error) {
      for (const [name, def] of Object.entries(SYNC_SETTING_KEYS) as [SyncSettingName, (typeof SYNC_SETTING_KEYS)[SyncSettingName]][]) {
        const row = (data ?? []).find((r) => r.key === def.key);
        if (!row) continue;
        try {
          values[name] = { value: decryptSecretText(String(row.value_enc)), hint: String(row.hint ?? "") };
        } catch {
          // Undecryptable (e.g. the encryption secret changed): treat as not set so admins can re-enter it.
        }
      }
    }
  } catch {
    // Table not migrated or database unreachable: fall back to environment variables only.
  }
  cache = { at: Date.now(), values };
  return values;
}

/** Effective credentials for the sync providers. */
export async function resolveSyncConfig(): Promise<SyncConfig> {
  const stored = await loadStored();
  const pick = (name: SyncSettingName) => {
    const env = process.env[SYNC_SETTING_KEYS[name].env]?.trim();
    if (env) return { value: env, source: "env" as const };
    const app = stored[name]?.value?.trim();
    return app ? { value: app, source: "app" as const } : { value: "", source: "none" as const };
  };
  const yt = pick("youtubeApiKey");
  const token = pick("metaAccessToken");
  const ig = pick("metaIgBusinessId");
  const ai = pick("anthropicApiKey");
  return {
    youtubeApiKey: yt.value,
    metaAccessToken: token.value,
    metaIgBusinessId: ig.value,
    anthropicApiKey: ai.value,
    source: { youtubeApiKey: yt.source, metaAccessToken: token.source, metaIgBusinessId: ig.source, anthropicApiKey: ai.source },
  };
}

const hintFor = (value: string) => (value.length <= 8 ? "set" : `…${value.slice(-4)}`);

/** Saves (string) or removes (null) console-managed credentials. Keys pinned by environment variables are refused. */
export async function saveSyncSettings(actorId: string, updates: Partial<Record<SyncSettingName, string | null>>) {
  const sb = supabaseAdmin();
  for (const [name, raw] of Object.entries(updates) as [SyncSettingName, string | null | undefined][]) {
    if (raw === undefined) continue;
    const def = SYNC_SETTING_KEYS[name];
    if (process.env[def.env]?.trim()) throw new ApiError(409, `${def.env} is set on the server, so it can't be changed here.`);
    if (raw === null || !raw.trim()) {
      const { error } = await sb.from("integration_settings").delete().eq("key", def.key);
      databaseError(error);
      continue;
    }
    const value = raw.trim();
    if (value.length > 4000) throw new ApiError(400, "That value is too long.", "invalid_input");
    const { error } = await sb
      .from("integration_settings")
      .upsert({ key: def.key, value_enc: encryptSecretText(value), hint: hintFor(value), updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "key" });
    databaseError(error);
  }
  await sb.from("audit_events").insert({ actor_id: actorId, action: "integration_settings_updated", resource_id: Object.keys(updates).join(",") }).then(() => undefined, () => undefined);
  if (["youtubeApiKey", "metaAccessToken", "metaIgBusinessId"].some(name => name in updates)) {
    // Newly connected credentials should recover waiting accounts on the next scheduler tick.
    const { error } = await sb.from("linked_social_accounts").update({ next_sync_at: new Date().toISOString(), sync_failures: 0 }).eq("status", "active").in("sync_status", ["error", "pending", "not_configured"]);
    databaseError(error);
  }
  await loadStored(true);
}

type TestResult = { ok: boolean; message: string };

async function callJson(url: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    return { ok: res.ok, status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

const apiMessage = (body: Record<string, unknown>) => String((body.error as Record<string, unknown> | undefined)?.message ?? "").slice(0, 200);

/** Live check of a credential set, used by "Test connection" before (or after) saving. */
export async function testSyncProvider(provider: "youtube" | "instagram" | "vision", candidate?: Partial<Record<SyncSettingName, string>> & { instagramHandle?: string }): Promise<TestResult> {
  const config = await resolveSyncConfig();
  if (provider === "vision") {
    const key = candidate?.anthropicApiKey?.trim() || config.anthropicApiKey;
    if (!key) return { ok: false, message: "Add an Anthropic API key first." };
    try {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (res.ok) return { ok: true, message: "The screenshot reader can use this key." };
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: false, message: apiMessage(body) || `Anthropic rejected the key (${res.status}).` };
    } catch {
      return { ok: false, message: "Anthropic didn't respond. Try again." };
    }
  }
  if (provider === "youtube") {
    const key = candidate?.youtubeApiKey?.trim() || config.youtubeApiKey;
    if (!key) return { ok: false, message: "Add a YouTube API key first." };
    const res = await callJson(`https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=%40YouTube&key=${encodeURIComponent(key)}`);
    if (res.ok) return { ok: true, message: "YouTube Data API is reachable with this key." };
    if (res.status === 0) return { ok: false, message: "YouTube didn't respond. Try again." };
    return { ok: false, message: apiMessage(res.body) || `YouTube rejected the key (${res.status}). Check that YouTube Data API v3 is enabled for it.` };
  }
  try {
    const metaAccessToken = candidate?.metaAccessToken?.trim() || config.metaAccessToken;
    const metaIgBusinessId = candidate?.metaIgBusinessId?.trim() || config.metaIgBusinessId;
    if (metaAccessToken || metaIgBusinessId) {
      const profile = await fetchInstagramBusinessProfile(candidate?.instagramHandle || "instagram", { metaAccessToken, metaIgBusinessId });
      return { ok: true, message: `Instagram API connected: ${profile.followers?.toLocaleString() ?? "hidden"} followers and ${profile.posts?.toLocaleString() ?? "hidden"} posts. Professional account statistics will sync automatically.` };
    }
    const profile = await fetchInstagramProfile(candidate?.instagramHandle || "instagram");
    return { ok: true, message: `Public profile readable: ${profile.followers?.toLocaleString() ?? "hidden"} followers, ${profile.posts?.toLocaleString() ?? "hidden"} posts, ${profile.media.length} exposed posts read. ${profile.note}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not read the Instagram profile." };
  }
}

/** What the console shows: per-provider connection state (never the values) and sync health. */
export async function syncIntegrationStatus() {
  const config = await resolveSyncConfig();
  const stored = await loadStored();
  const field = (name: SyncSettingName) => ({ source: config.source[name], hint: config.source[name] === "app" ? stored[name]?.hint ?? "set" : config.source[name] === "env" ? "set on server" : "" });
  let health = { active: 0, ok: 0, failing: 0, pending: 0, syncing: 0, lastSyncedAt: null as string | null };
  let scheduler = { healthy: false, lastRunAt: null as string | null, running: false };
  try {
    const sb = supabaseAdmin();
    const [{ data }, { data: heartbeat }] = await Promise.all([
      sb.from("linked_social_accounts").select("*").eq("status", "active").limit(2000),
      sb.from("social_sync_scheduler_state").select("*").eq("id", true).maybeSingle(),
    ]);
    const rows = data ?? [];
    const synced = rows.map((r) => r.last_synced_at).filter(Boolean).map(String).sort();
    const now = Date.now();
    const fresh = (r: Record<string, unknown>) => r.sync_status === "ok" && now - Date.parse(String(r.last_synced_at)) <= syncInterval(String(r.platform)) + 120_000;
    health = {
      active: rows.length,
      ok: rows.filter(fresh).length,
      failing: rows.filter((r) => r.sync_status === "error").length,
      pending: rows.filter(r => !fresh(r) && r.sync_status !== "error").length,
      syncing: rows.filter(r => Date.parse(String(r.sync_locked_until)) > now).length,
      lastSyncedAt: synced.at(-1) ?? null,
    };
    const last = heartbeat?.last_finished_at ? String(heartbeat.last_finished_at) : null;
    scheduler = {
      healthy: !!last && now - Date.parse(last) < 3 * 60_000,
      lastRunAt: last,
      running: !!heartbeat?.last_started_at && Date.parse(String(heartbeat.last_started_at)) > (Date.parse(String(last)) || 0) && now - Date.parse(String(heartbeat.last_started_at)) < 120_000,
    };
  } catch {
    // health is optional
  }
  return {
    youtube: { connected: !!config.youtubeApiKey, fields: { youtubeApiKey: field("youtubeApiKey") } },
    instagram: { connected: true, mode: config.metaAccessToken && config.metaIgBusinessId ? "api" as const : "profile" as const, fields: { metaAccessToken: field("metaAccessToken"), metaIgBusinessId: field("metaIgBusinessId") } },
    vision: { connected: !!config.anthropicApiKey, fields: { anthropicApiKey: field("anthropicApiKey") } },
    health,
    scheduler,
  };
}
