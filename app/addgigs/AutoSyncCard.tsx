"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useCallback, useEffect, useState } from "react";
import { useAdminCachedResource } from "@/lib/useAdminCachedResource";
import { isCurrentAdminCacheIdentity } from "@/lib/adminCacheIdentity";
import { useVisibleRefresh } from "@/lib/useVisibleRefresh";
import PlatformGlyph from "../dashboard/PlatformGlyph";
import { ICONS, Icon, Spinner, btnGhost, btnPrimary, cardClass, fieldClass, formatRelative } from "./adminUi";

// Configure automatic stats readers for linked accounts. Secrets are sent once and stored
// encrypted on the server; this card only ever receives connection state and a short hint.

type FieldState = { source: "env" | "app" | "none"; hint: string };
type Status = {
  youtube: { connected: boolean; fields: { youtubeApiKey: FieldState } };
  instagram: { connected: boolean; fields: { metaAccessToken: FieldState; metaIgBusinessId: FieldState } };
  vision: { connected: boolean; fields: { anthropicApiKey: FieldState } };
  health: { active: number; ok: number; failing: number; lastSyncedAt: string | null };
};
type Provider = "youtube" | "instagram" | "vision";

/** Persist connection state only: API keys and values typed into ProviderForm never enter this model. */
function connectionStatus(value: unknown): Status {
  const payload = value as Partial<Status> | null;
  if (!payload || typeof payload.youtube?.connected !== "boolean" || typeof payload.instagram?.connected !== "boolean") {
    throw new Error("Couldn't load auto-sync status.");
  }
  const field = (candidate: unknown): FieldState => {
    const source = (candidate as Partial<FieldState> | null)?.source;
    return { source: source === "app" || source === "env" ? source : "none", hint: source === "app" ? "••••" : source === "env" ? "set on server" : "" };
  };
  const count = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? Math.floor(candidate) : 0;
  const date = payload.health?.lastSyncedAt;
  return {
    youtube: { connected: payload.youtube.connected, fields: { youtubeApiKey: field(payload.youtube.fields?.youtubeApiKey) } },
    instagram: { connected: payload.instagram.connected, fields: { metaAccessToken: field(payload.instagram.fields?.metaAccessToken), metaIgBusinessId: field(payload.instagram.fields?.metaIgBusinessId) } },
    vision: { connected: payload.vision?.connected === true, fields: { anthropicApiKey: field(payload.vision?.fields?.anthropicApiKey) } },
    health: { active: count(payload.health?.active), ok: count(payload.health?.ok), failing: count(payload.health?.failing), lastSyncedAt: typeof date === "string" && Number.isFinite(Date.parse(date)) ? date : null },
  };
}

function validConnectionStatus(value: unknown): value is Status {
  const data = value as Status | null;
  if (!data || !data.health || !["active", "ok", "failing"].every(key => typeof data.health[key as "active"] === "number" && Number.isFinite(data.health[key as "active"]))) return false;
  return (["youtube", "instagram", "vision"] as const).every(provider => {
    const current = data[provider];
    return current && typeof current.connected === "boolean" && current.fields && typeof current.fields === "object"
      && Object.values(current.fields).every(field => field && ["env", "app", "none"].includes(field.source) && typeof field.hint === "string");
  }) && (data.health.lastSyncedAt === null || typeof data.health.lastSyncedAt === "string");
}

const PROVIDERS: Record<
  Provider,
  { label: string; platformId: "youtube" | "instagram" | "other"; reads: string; fields: { name: string; label: string; placeholder: string; secret: boolean }[]; steps: { text: string; href?: string }[] }
> = {
  youtube: {
    label: "YouTube",
    platformId: "youtube",
    reads: "Subscribers, channel views, videos, and each Short's views, likes and comments.",
    fields: [{ name: "youtubeApiKey", label: "YouTube Data API key", placeholder: "AIza…", secret: true }],
    steps: [
      { text: "Open Google Cloud console and create (or pick) a project.", href: "https://console.cloud.google.com/projectcreate" },
      { text: "Enable “YouTube Data API v3” for it.", href: "https://console.cloud.google.com/apis/library/youtube.googleapis.com" },
      { text: "Credentials → Create credentials → API key. Restrict it to YouTube Data API v3, then paste it here.", href: "https://console.cloud.google.com/apis/credentials" },
    ],
  },
  instagram: {
    label: "Instagram",
    platformId: "instagram",
    reads: "Public profile followers, following and post counts, plus exposed post likes, comments and video views. No Meta API key or Professional account required. Hidden metrics stay unavailable.",
    fields: [],
    steps: [
      { text: "Approve and link the creator's Instagram handle. Profile reading is ready automatically." },
      { text: "Use Sync now on a linked account, or let the existing scheduled job and page refresh read stale accounts." },
      { text: "If Instagram requires login or limits reads, keep the last successful data and update from screenshots. Reach, saves and shares require insight screenshots." },
    ],
  },
  vision: {
    label: "Screenshot reader",
    platformId: "other",
    reads: "Any platform, no API: creators upload insight screenshots (profile, Professional dashboard, reel insights) and AI reads followers, reach, views, likes, shares and saves. Works today for Instagram reel views and reach.",
    fields: [{ name: "anthropicApiKey", label: "Anthropic API key", placeholder: "sk-ant-…", secret: true }],
    steps: [
      { text: "Sign in to the Anthropic Console and add billing.", href: "https://console.anthropic.com/" },
      { text: "Settings → API keys → Create key. Paste it here.", href: "https://console.anthropic.com/settings/keys" },
      { text: "Creators then see “Update from screenshots” on their Accounts page; you get “Fill from screenshots” on check-ins." },
    ],
  },
};

function SourceBadge({ connected, fields }: { connected: boolean; fields: FieldState[] }) {
  if (!connected) return <span className="rounded-[999px] bg-[#f1f3f0] px-2 py-0.5 text-[11px] font-semibold text-[#616a64]">Not connected</span>;
  if (!fields.length) return <span className="rounded-full bg-[#ebf5ee] px-2 py-0.5 text-[11px] font-semibold text-[#1d5c37]">Profile reader ready</span>;
  const env = fields.some((f) => f.source === "env");
  const hint = fields.find((f) => f.source === "app" && f.hint)?.hint;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[999px] bg-[#ebf5ee] px-2 py-0.5 text-[11px] font-semibold text-[#1d5c37]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#2e7d4f]" aria-hidden />
      Connected {env ? "· server" : hint ? `· ${hint}` : ""}
    </span>
  );
}

function ProviderForm({ adminId, provider, status, onSaved, onClose }: { adminId: string; provider: Provider; status: Status; onSaved: (next: Status) => void; onClose: () => void }) {
  const def = PROVIDERS[provider];
  const fieldStates = status[provider].fields as Record<string, FieldState>;
  const pinned = def.fields.some((f) => fieldStates[f.name]?.source === "env");
  const [values, setValues] = useState<Record<string, string>>({});
  const [profileHandle, setProfileHandle] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<"test" | "save" | "remove" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const typed = def.fields.some((f) => (values[f.name] ?? "").trim());
  // A new connection needs every field; an existing one can update just one of them.
  const complete = def.fields.every((f) => (values[f.name] ?? "").trim() || fieldStates[f.name]?.source === "app");

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/integrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await res.json().catch(() => null);
    if ((res.status === 401 || res.status === 403) && isCurrentAdminCacheIdentity(adminId)) window.dispatchEvent(new Event("admin-auth-invalidated"));
    if (!res.ok) throw new Error(payload?.error || "Request failed.");
    return payload;
  };
  const clean = () => provider === "instagram" ? { instagramHandle: profileHandle.trim().replace(/^@/, "") || "instagram" } : Object.fromEntries(def.fields.map((f) => [f.name, (values[f.name] ?? "").trim()]).filter(([, v]) => v));

  return (
    <div className="mt-3 grid gap-4 rounded-[14px] border border-[#e3e5e1] bg-[#fafbf9] p-3.5 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold text-[#1a201c]">Reads</p>
        <p className="mt-0.5 text-[12.5px] leading-5 text-[#616a64]">{def.reads}</p>
        <ol className="mt-3 space-y-2">
          {def.steps.map((step, i) => (
            <li key={step.text} className="flex gap-2.5 text-[12.5px] leading-5 text-[#3b443e]">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eef1ed] text-[10.5px] font-bold text-[#2b5d4a]">{i + 1}</span>
              <span className="min-w-0">
                {step.text}{" "}
                {step.href ? (
                  <a href={step.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-[#2b5d4a] underline-offset-2 hover:underline">
                    Open <Icon d={ICONS.open} className="h-3 w-3" />
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <form
        className="min-w-0 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!typed || !complete || busy) return;
          setBusy("save");
          setResult(null);
          try {
            // Save only after a successful live test, so a typo never silently breaks syncing.
            const test = (await call({ action: "test", provider, values: clean() })) as { ok: boolean; message: string };
            if (!test.ok) {
              setResult(test);
              return;
            }
            onSaved((await call({ action: "save", values: clean() })) as Status);
            setValues({});
            setResult({ ok: true, message: `${test.message} Saved. Accounts on ${def.label} will sync on their next load.` });
          } catch (err) {
            setResult({ ok: false, message: err instanceof Error ? err.message : "Couldn't save." });
          } finally {
            setBusy(null);
          }
        }}
      >
        {provider === "instagram" ? (
          <label className="block text-[12px] font-medium text-[#1a201c]">
            Test a public Instagram handle
            <input value={profileHandle} onChange={(e) => setProfileHandle(e.target.value)} placeholder="@instagram" maxLength={31} autoComplete="off" spellCheck={false} className={`${fieldClass} mt-1 h-10`} />
            <span className="mt-2 block font-normal leading-5 text-[#616a64]">Profile reader ready. Test a specific handle to check whether Instagram exposes its data to this server.</span>
          </label>
        ) : null}
        {pinned ? (
          <p className="rounded-[10px] border border-[#e3e5e1] bg-white px-3 py-2 text-[12px] text-[#4b544e]">
            These credentials are set as server environment variables, so they&apos;re managed there. You can still test the connection.
          </p>
        ) : null}
        {def.fields.map((f) => {
          const state = fieldStates[f.name];
          return (
            <label key={f.name} className="block text-[12px] font-medium text-[#1a201c]">
              <span className="flex items-baseline justify-between gap-2">
                {f.label}
                {state?.source === "app" ? <span className="text-[11px] font-normal text-[#8a928c]">saved {state.hint}</span> : null}
              </span>
              <input
                type={f.secret && !reveal ? "password" : "text"}
                value={values[f.name] ?? ""}
                disabled={pinned}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                placeholder={state?.source === "app" ? "Leave empty to keep the saved value" : f.placeholder}
                autoComplete="off"
                spellCheck={false}
                inputMode={f.secret ? undefined : "numeric"}
                className={`${fieldClass} mt-1 h-10 font-mono text-[13px]`}
              />
            </label>
          );
        })}
        {def.fields.some((f) => f.secret) && !pinned ? (
          <label className="flex items-center gap-2 text-[12px] text-[#616a64]">
            <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} className="h-4 w-4 accent-[#1f2b24]" />
            Show while typing
          </label>
        ) : null}
        {result ? (
          <p role="status" className={`rounded-[10px] px-3 py-2 text-[12.5px] ${result.ok ? "bg-[#ebf5ee] text-[#1d5c37]" : "bg-[#fdf2f1] text-[#8e1f1a]"}`}>
            {result.message}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {status[provider].connected && !pinned && provider !== "instagram" ? (
            <button
              type="button"
              className={`${btnGhost} text-[#b42318] sm:mr-auto`}
              disabled={!!busy}
              onClick={async () => {
                setBusy("remove");
                setResult(null);
                try {
                  onSaved((await call({ action: "save", values: Object.fromEntries(def.fields.map((f) => [f.name, null])) })) as Status);
                  setResult({ ok: true, message: `${def.label} disconnected. Its accounts fall back to manual check-ins.` });
                } catch (err) {
                  setResult({ ok: false, message: err instanceof Error ? err.message : "Couldn't disconnect." });
                } finally {
                  setBusy(null);
                }
              }}
            >
              Disconnect
            </button>
          ) : null}
          <button type="button" className={btnGhost} onClick={onClose} disabled={!!busy}>
            Close
          </button>
          <button
            type="button"
            className={btnGhost}
            disabled={!!busy || (!typed && !status[provider].connected)}
            onClick={async () => {
              setBusy("test");
              setResult(null);
              try {
                setResult((await call({ action: "test", provider, values: clean() })) as { ok: boolean; message: string });
              } catch (err) {
                setResult({ ok: false, message: err instanceof Error ? err.message : "Test failed." });
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "test" ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.refresh} />}
            {provider === "instagram" ? "Test profile read" : "Test connection"}
          </button>
          {!pinned && provider !== "instagram" ? (
            <button type="submit" className={btnPrimary} disabled={!!busy || !typed || !complete}>
              {busy === "save" ? <Spinner /> : <Icon d={ICONS.save} />}
              Test &amp; save
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

export default function AutoSyncCard({ adminId, onChanged }: { adminId: string; onChanged: () => void }) {
  const [open, setOpen] = useState<Provider | null>(null);

  const read = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/admin/integrations", { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    const payload = await res.json().catch(() => null);
    if ((res.status === 401 || res.status === 403) && !signal.aborted && isCurrentAdminCacheIdentity(adminId)) window.dispatchEvent(new Event("admin-auth-invalidated"));
    if (!res.ok) throw new Error(payload?.error || "Couldn't load auto-sync status.");
    return connectionStatus(payload);
  }, [adminId]);
  const resource = useAdminCachedResource({ scope: adminId, key: "integration-status", load: read, ttlMs: 60_000, maxAgeMs: 15 * 60_000, persist: true, validate: validConnectionStatus });
  const { refresh, update } = resource;
  const status = resource.data ?? null;
  const error = resource.error?.message ?? null;
  const poll = useCallback(async () => {
    if (navigator.onLine) await refresh({ force: false });
  }, [refresh]);
  useVisibleRefresh(poll, adminId ? 60_000 : null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const manual = () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; void refresh({ afterCurrent: true }); }, 100);
    };
    window.addEventListener("admin-refresh", manual);
    window.addEventListener("admin-linked-accounts-refresh", manual);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("admin-refresh", manual);
      window.removeEventListener("admin-linked-accounts-refresh", manual);
    };
  }, [refresh]);

  const connectedCount = status ? Number(status.youtube.connected) + Number(status.instagram.connected) + Number(status.vision?.connected ?? false) : 0;
  const health = status?.health;

  return (
    <section className={`${cardClass} p-3.5 sm:p-4`} aria-labelledby="auto-sync-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 id="auto-sync-title" className="flex items-center gap-2 text-[14.5px] font-semibold text-[#1a201c]">
            Auto-sync
            {status ? (
              <span className={`rounded-[999px] px-2 py-0.5 text-[11px] font-semibold ${connectedCount ? "bg-[#ebf5ee] text-[#1d5c37]" : "bg-[#fff4df] text-[#8a5300]"}`}>
                {connectedCount ? `${connectedCount} of 3 readers ready` : "Off"}
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[#616a64]">
            {error
              ? <>{error} <button type="button" onClick={() => void refresh()} className="font-semibold underline underline-offset-2">Try again</button></>
              : !status
                ? "Checking connections…"
                : connectedCount && health
                  ? `${health.ok} of ${health.active} active account${health.active === 1 ? "" : "s"} syncing${health.lastSyncedAt ? ` · last sync ${formatRelative(health.lastSyncedAt)}` : ""}${health.failing ? ` · ${health.failing} failing` : ""}`
                  : "Instagram reads public profiles without API credentials. Connect YouTube or the screenshot reader for additional insights."}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:flex lg:shrink-0">
          {(Object.keys(PROVIDERS) as Provider[]).map((p) => {
            const def = PROVIDERS[p];
            const st = status?.[p];
            return (
              <button
                key={p}
                type="button"
                disabled={!status}
                onClick={() => setOpen((cur) => (cur === p ? null : p))}
                aria-expanded={open === p}
                className={`flex min-w-0 items-center gap-2.5 rounded-[12px] border px-3 py-2 text-left transition ${open === p ? "border-[#1f2b24] bg-[#f4f6f3]" : "border-[#e3e5e1] bg-white hover:bg-[#fafbf9]"}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#1f2b24] text-white">
                  <PlatformGlyph platform={{ id: def.platformId }} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-[#1a201c]">{def.label}</span>
                  {st ? <SourceBadge connected={st.connected} fields={p === "instagram" ? [] : Object.values(st.fields)} /> : <span className="text-[11px] text-[#8a928c]">…</span>}
                </span>
                <span className="shrink-0 text-[12px] font-semibold text-[#2b5d4a]">{p === "instagram" ? "Details" : st?.connected ? "Manage" : "Connect"}</span>
              </button>
            );
          })}
        </div>
      </div>
      {open && status ? (
        <ProviderForm
          key={`${adminId}:${open}`}
          adminId={adminId}
          provider={open}
          status={status}
          onClose={() => setOpen(null)}
          onSaved={(next) => {
            // Saving a connection wins over an older GET, and only its redacted status is cached.
            update(connectionStatus(next));
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
