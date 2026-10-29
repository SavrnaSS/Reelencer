"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVisibleRefresh } from "@/lib/useVisibleRefresh";
import { useAdminCachedResource } from "@/lib/useAdminCachedResource";
import { adminSessionCache } from "@/lib/adminSessionCache";
import { isCurrentAdminCacheIdentity } from "@/lib/adminCacheIdentity";
import { readAdminFilter, saveAdminFilter } from "@/lib/adminPreferences";
import { LINKED_ACCOUNTS_CACHE_KEY, LINKED_ACCOUNTS_FRESH_MS, LINKED_SYNC_CACHE_KEY, LINKED_SYNC_ATTEMPT_KEY, isLinkedAccountsData, isLinkedSyncAttempt, linkedAccountsData, linkedSyncDue, type LinkedAccountsData } from "@/lib/linkedAccountCache";
import AdminSectionLoading from "@/app/_components/AdminSectionLoading";
import SocialSyncStatus from "@/app/_components/SocialSyncStatus";
import LinkedAccountRecovery from "@/app/dashboard/LinkedAccountRecovery";
import { needsProfileRecovery } from "@/lib/accountProfileHealth";
import { syncPresentation } from "@/lib/socialSyncSchedule";
import type { AdminLiveKind } from "@/lib/useAdminLive";
import { accountPlatformFor } from "@/lib/accountSetup";
import {
  SNAPSHOT_FIELDS,
  STALE_AFTER_DAYS,
  daysSinceSnapshot,
  engagementRate,
  formatCompact,
  formatPct,
  metricChange,
  metricSeries,
  parseMetricInput,
  reelEarnings,
  type LinkedSocialAccount,
  type SnapshotMetric,
  type SocialAccountStatus,
  type SocialPost,
  type SocialSnapshot,
} from "@/lib/socialAnalytics";
import MetricChart from "../dashboard/MetricChart";
import AutoSyncCard from "./AutoSyncCard";
import ReelList from "./ReelList";
import { countedReels, trackingStartInput } from "@/lib/reelTracking";
import AccountRequestsQueue from "./AccountRequestsQueue";
import PlatformGlyph from "../dashboard/PlatformGlyph";
import { Banner, ConfirmDialog, EmptyState, ICONS, Icon, SectionLabel, Spinner, StatusChip, btnGhost, btnIcon, btnPrimary, cardClass, fieldClass, formatDate, formatDateTime } from "./adminUi";

// Admin: every account linked after Content Posting screening. The team logs in, reads the platform's insights and
// records them here as check-ins; creators see the result in Dashboard → Accounts.

type Filter = "all" | "attention" | "due" | "reels" | "active" | "paused" | "unlinked";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attention", label: "Profile verification" },
  { id: "due", label: "Check-in due" },
  { id: "reels", label: "Reels to review" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "unlinked", label: "Unlinked" },
];
const STATUS_TONE: Record<SocialAccountStatus, "success" | "warning" | "neutral"> = { active: "success", paused: "warning", unlinked: "neutral" };
const POST_FIELDS = ["views", "reach", "likes", "comments", "shares", "saves"] as const;

const isDue = (account: LinkedSocialAccount, now: number) => {
  if (account.status !== "active") return false;
  // Healthy auto-sync keeps the numbers fresh by itself.
  if (syncPresentation(account, now).tone === "success") return false;
  const days = daysSinceSnapshot(account.snapshots, now);
  return days === undefined || days >= STALE_AFTER_DAYS;
};
/** Reels waiting for review inside the account's tracking window. */
const toReview = (account: LinkedSocialAccount) => countedReels(account.posts, account.linkedAt).filter((p) => p.status === "submitted").length;
const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

async function adminPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/admin/social-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error || "The change couldn't be saved.");
  return payload as T;
}

type ScreenshotReading = {
  handle?: string;
  account: Partial<Record<"followers" | "following" | "posts" | "periodDays" | "reach" | "impressions" | "profileViews" | "engagements" | "linkClicks", number>>;
  reels: Partial<Record<"views" | "reach" | "likes" | "comments" | "shares" | "saves", number>>[];
  confidence: number;
  warnings: string[];
};

/** Reads screenshots without saving (admin preview), so the numbers land in a form for review first. */
async function previewScreenshots(accountId: string, files: FileList): Promise<ScreenshotReading> {
  const form = new FormData();
  form.set("accountId", accountId);
  form.set("mode", "preview");
  Array.from(files)
    .slice(0, 6)
    .forEach((file) => form.append("screenshots", file));
  const res = await fetch("/api/social-accounts/screenshots", { method: "POST", body: form });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error || "The screenshots couldn't be read.");
  return payload.reading as ScreenshotReading;
}

/** "Fill from screenshot" button: hidden file input + reading state. */
function ScreenshotFillButton({ accountId, onReading, label = "Fill from screenshots" }: { accountId: string; onReading: (reading: ScreenshotReading) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <label className={`${btnGhost} h-8 cursor-pointer px-2.5 text-[12px] ${busy ? "pointer-events-none opacity-60" : ""}`}>
        {busy ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.image} className="h-3.5 w-3.5" />}
        {busy ? "Reading…" : label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          onChange={async (e) => {
            const files = e.target.files;
            e.target.value = "";
            if (!files?.length) return;
            setBusy(true);
            setNote(null);
            try {
              const reading = await previewScreenshots(accountId, files);
              onReading(reading);
              setNote({ ok: true, text: `Filled from ${files.length} screenshot${files.length === 1 ? "" : "s"} · ${Math.round(reading.confidence * 100)}% sure${reading.handle ? ` · @${reading.handle}` : ""}. Check, then save.${reading.warnings.length ? ` ${reading.warnings.join(" ")}` : ""}` });
            } catch (err) {
              setNote({ ok: false, text: err instanceof Error ? err.message : "Couldn't read the screenshots." });
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {note ? <span className={`max-w-[46ch] text-[11.5px] sm:text-right ${note.ok ? "text-[#1d5c37]" : "text-[#b42318]"}`}>{note.text}</span> : null}
    </div>
  );
}

function NumberField({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  const invalid = value.trim() !== "" && parseMetricInput(value) === undefined;
  return (
    <label className="block min-w-0 text-[12px] font-medium text-[#1a201c]">
      <span className="flex items-baseline justify-between gap-1">
        <span className="truncate">{label}</span>
        {hint ? <span className="shrink-0 text-[10.5px] font-normal text-[#8a928c]">{hint}</span> : null}
      </span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid}
        className={`${fieldClass} mt-1 h-10 tabular-nums ${invalid ? "border-[#e7a19a] focus:border-[#d03b3b]" : ""}`}
      />
    </label>
  );
}

function CheckInForm({ account, screenshotReader, onSaved }: { account: LinkedSocialAccount; screenshotReader: boolean; onSaved: (snapshot: SocialSnapshot) => void }) {
  const last = account.snapshots.at(-1);
  const [values, setValues] = useState<Record<string, string>>({});
  const [periodDays, setPeriodDays] = useState(last?.periodDays ?? 7);
  const [capturedAt, setCapturedAt] = useState(() => localInput(new Date()));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = Object.fromEntries(SNAPSHOT_FIELDS.map((f) => [f.key, parseMetricInput(values[f.key] ?? "")]));
  const invalid = SNAPSHOT_FIELDS.some((f) => (values[f.key] ?? "").trim() && parsed[f.key] === undefined);
  const filled = SNAPSHOT_FIELDS.filter((f) => parsed[f.key] !== undefined).length;

  const save = async () => {
    if (!filled || invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { snapshot } = await adminPost<{ snapshot: SocialSnapshot }>({
        action: "snapshot",
        accountId: account.id,
        capturedAt: new Date(capturedAt).toISOString(),
        periodDays,
        note: note.trim() || undefined,
        ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)),
      });
      onSaved(snapshot);
      setValues({});
      setNote("");
      setCapturedAt(localInput(new Date()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check-in couldn't be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="rounded-[14px] border border-[#e3e5e1] bg-[#fafbf9] p-3.5 sm:p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-[13.5px] font-semibold text-[#1a201c]">Record a check-in</h4>
          <span className="text-[11.5px] text-[#7a827c]">Type numbers as shown in insights. 12,400, 12.4k and 1.2m all work.</span>
        </div>
        {screenshotReader ? (
          <ScreenshotFillButton
            accountId={account.id}
            onReading={(reading) => {
              const a = reading.account;
              setValues((prev) => ({
                ...prev,
                ...Object.fromEntries(
                  SNAPSHOT_FIELDS.filter((f) => a[f.key as keyof typeof a] !== undefined).map((f) => [f.key, String(a[f.key as keyof typeof a])]),
                ),
              }));
              if (a.periodDays) setPeriodDays([7, 14, 28, 30, 90].includes(a.periodDays) ? a.periodDays : 7);
              setNote((prev) => prev || "From insight screenshots");
            }}
          />
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <label className="col-span-2 block text-[12px] font-medium text-[#1a201c] sm:col-span-1">
          Captured
          <input type="datetime-local" value={capturedAt} max={localInput(new Date())} onChange={(e) => setCapturedAt(e.target.value)} className={`${fieldClass} mt-1 h-10`} />
        </label>
        <label className="col-span-2 block text-[12px] font-medium text-[#1a201c] sm:col-span-1">
          Insights period
          <select value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} className={`${fieldClass} mt-1 h-10`}>
            {[7, 14, 28, 30, 90].map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {SNAPSHOT_FIELDS.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            hint={f.period ? `${periodDays}d` : "total"}
            value={values[f.key] ?? ""}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
            placeholder={last?.[f.key] !== undefined ? `was ${formatCompact(last[f.key] as number)}` : "–"}
          />
        ))}
      </div>
      <label className="mt-2.5 block text-[12px] font-medium text-[#1a201c]">
        Note <span className="font-normal text-[#8a928c]">(optional, team only)</span>
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Reel from 3 Oct boosted reach" className={`${fieldClass} mt-1 h-10`} />
      </label>
      {error ? <p className="mt-2 text-[12px] text-[#b42318]">{error}</p> : null}
      <div className="mt-3 flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[11.5px] text-[#7a827c]">{filled ? `${filled} of ${SNAPSHOT_FIELDS.length} numbers filled` : "Fill at least one number."}</span>
        <button type="submit" className={`${btnPrimary} h-10`} disabled={!filled || invalid || saving}>
          {saving ? <Spinner /> : <Icon d={ICONS.save} />}
          Save check-in
        </button>
      </div>
    </form>
  );
}

function PostEditor({
  account,
  editing,
  screenshotReader,
  onSaved,
  onCancel,
}: {
  account: LinkedSocialAccount;
  editing: SocialPost | null;
  screenshotReader: boolean;
  onSaved: (post: SocialPost) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(editing?.url ?? "");
  const [caption, setCaption] = useState(editing?.caption ?? "");
  const [postedAt, setPostedAt] = useState(editing?.postedAt ? editing.postedAt.slice(0, 10) : "");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(POST_FIELDS.map((k) => [k, editing?.[k] !== undefined ? String(editing[k]) : ""])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = Object.fromEntries(POST_FIELDS.map((k) => [k, parseMetricInput(values[k] ?? "")]));
  const invalid = POST_FIELDS.some((k) => (values[k] ?? "").trim() && parsed[k] === undefined) || !/^https:\/\/\S+$/i.test(url.trim());

  const save = async () => {
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { post } = await adminPost<{ post: SocialPost }>({
        action: "post",
        accountId: account.id,
        url: url.trim(),
        caption: caption.trim() || undefined,
        postedAt: postedAt ? new Date(`${postedAt}T12:00:00`).toISOString() : undefined,
        ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)),
      });
      onSaved(post);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The reel couldn't be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="rounded-[14px] border border-[#cfe3d4] bg-[#f6faf5] p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <label className="block text-[12px] font-medium text-[#1a201c]">
          Reel link
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/…" inputMode="url" disabled={!!editing} className={`${fieldClass} mt-1 h-10`} />
        </label>
        <label className="block text-[12px] font-medium text-[#1a201c]">
          Posted on
          <input type="date" value={postedAt} min={trackingStartInput(account.linkedAt)} onChange={(e) => setPostedAt(e.target.value)} className={`${fieldClass} mt-1 h-10`} />
        </label>
      </div>
      <label className="mt-2.5 block text-[12px] font-medium text-[#1a201c]">
        Caption or title
        <input value={caption} maxLength={300} onChange={(e) => setCaption(e.target.value)} placeholder="3 budget hacks in Pune" className={`${fieldClass} mt-1 h-10`} />
      </label>
      {screenshotReader ? (
        <div className="mt-2.5">
          <ScreenshotFillButton
            accountId={account.id}
            label="Fill from reel insights screenshot"
            onReading={(reading) => {
              const reel = reading.reels[0];
              if (!reel) return;
              setValues((prev) => ({ ...prev, ...Object.fromEntries(POST_FIELDS.filter((k) => reel[k] !== undefined).map((k) => [k, String(reel[k])])) }));
            }}
          />
        </div>
      ) : null}
      <div className="mt-2.5 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
        {POST_FIELDS.map((k) => (
          <NumberField key={k} label={k[0].toUpperCase() + k.slice(1)} value={values[k] ?? ""} onChange={(v) => setValues((prev) => ({ ...prev, [k]: v }))} />
        ))}
      </div>
      {error ? <p className="mt-2 text-[12px] text-[#b42318]">{error}</p> : null}
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={btnGhost} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={invalid || saving}>
          {saving ? <Spinner /> : <Icon d={ICONS.save} />}
          {editing ? "Update reel" : "Add reel"}
        </button>
      </div>
    </form>
  );
}

function AccountDetail({
  account,
  now,
  screenshotReader,
  onChange,
  onBack,
}: {
  account: LinkedSocialAccount;
  now: number;
  screenshotReader: boolean;
  onChange: (next: LinkedSocialAccount) => void;
  onBack?: () => void;
}) {
  const platform = accountPlatformFor(account.platform);
  const [chartMetric, setChartMetric] = useState<SnapshotMetric>("followers");
  const [postEditor, setPostEditor] = useState<{ post: SocialPost | null } | null>(null);
  const [reportMissing, setReportMissing] = useState(false);
  // Bulk approvals finish out of order: each one builds on the latest account, not the one it started from.
  const latestAccount = useRef(account);
  useEffect(() => { latestAccount.current = account; }, [account]);
  const replacePost = (updated: SocialPost) => {
    const next = { ...latestAccount.current, posts: latestAccount.current.posts.map((p) => (p.id === updated.id ? updated : p)) };
    latestAccount.current = next;
    onChange(next);
  };
  // The reel list shows the outcome beside the reel itself (and runs approvals in bulk), so errors go back to it.
  const review = async (post: SocialPost, status: "approved" | "rejected", note?: string): Promise<{ ok: true } | { error: string }> => {
    try {
      const { post: updated } = await adminPost<{ post: SocialPost }>({ action: "review_post", id: post.id, status, note });
      replacePost(updated);
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "The review couldn't be saved." };
    }
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = account.snapshots.at(-1);
  const followers = metricChange(account.snapshots, "followers");
  const observedTotal = (key: "views" | "likes") => {
    const measured = countedReels(account.posts, account.linkedAt).filter((post) => typeof post[key] === "number");
    return { value: measured.length ? measured.reduce((sum, post) => sum + (post[key] ?? 0), 0) : undefined, count: measured.length };
  };
  const reelViews = observedTotal("views");
  const reelLikes = observedTotal("likes");
  const earnings = reelEarnings(account);
  const due = isDue(account, now);
  const days = daysSinceSnapshot(account.snapshots, now);

  const run = async <T,>(key: string, body: Record<string, unknown>, apply: (payload: T) => void) => {
    setBusy(key);
    setError(null);
    try {
      const payload = await adminPost<T>(body);
      apply(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change couldn't be saved.");
    } finally {
      setBusy(null);
    }
  };

  // Remove and restore report errors back to the reel list, which shows them beside the reel (and runs them in bulk).
  const reelAction = async <T,>(id: string, body: Record<string, unknown>): Promise<T | { error: string }> => {
    setBusy(id);
    try {
      return await adminPost<T>(body);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "The change couldn't be saved." };
    } finally {
      setBusy((current) => (current === id ? null : current));
    }
  };

  return (
    <article className={`${cardClass} overflow-hidden`}>
      <header className="flex flex-wrap items-start gap-3 border-b border-[#eef0ec] px-4 py-4 sm:px-5">
        {onBack ? (
          <button type="button" className={`${btnIcon} -ml-1`} onClick={onBack} aria-label="Back to accounts">
            <Icon d={ICONS.chevronLeft} />
          </button>
        ) : null}
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#1f2b24] text-white">
          <PlatformGlyph platform={platform} className="h-5.5 w-5.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href={account.profileUrl} target="_blank" rel="noreferrer" className="truncate text-[17px] font-semibold text-[#1a201c] underline-offset-2 hover:underline">
              @{account.handle}
            </a>
            <StatusChip label={account.status[0].toUpperCase() + account.status.slice(1)} tone={STATUS_TONE[account.status]} />
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-[#616a64]">
            {platform.label} · {account.gigTitle ?? account.gigId} · creator {account.workerCode}
          </p>
          <p className="mt-0.5 text-[11.5px] text-[#8a928c]">Linked {formatDate(account.linkedAt)}</p>
          <div className="mt-2"><SocialSyncStatus account={account} now={now} /></div>
          {account.status !== "unlinked" ? <button type="button" onClick={() => setReportMissing(true)} className="mt-1 inline-flex min-h-9 items-center rounded-md text-[11.5px] font-medium text-[#8a6a36] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#8a6a36]">Profile not found?</button> : null}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          {account.sync.available ? (
            <button
              type="button"
              className={`${btnGhost} whitespace-nowrap sm:flex-none`}
              disabled={!!busy || account.status !== "active" || account.sync.inProgress}
              onClick={async () => {
                setBusy("sync");
                setError(null);
                try {
                  const { account: fresh } = await adminPost<{ account: LinkedSocialAccount }>({ action: "sync", accountId: account.id });
                  if (fresh) onChange(fresh);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Sync failed.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "sync" ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.refresh} />}
              {busy === "sync" || account.sync.inProgress ? "Syncing…" : "Sync now"}
            </button>
          ) : null}
          <a href={`/addgigs/applications?gig=${encodeURIComponent(account.gigId)}`} className={`${btnGhost} whitespace-nowrap sm:flex-none`} title="Login details are on the application">
            <Icon d={ICONS.lock} />
            Login details
          </a>
          <label className="sr-only" htmlFor={`status-${account.id}`}>
            Account status
          </label>
          <select
            id={`status-${account.id}`}
            value={account.status}
            disabled={busy === "status" || needsProfileRecovery(account)}
            onChange={(e) => {
              const status = e.target.value as SocialAccountStatus;
              void run("status", { action: "status", accountId: account.id, status }, () => onChange({ ...account, status }));
            }}
            className={`${fieldClass} col-span-2 h-9 w-full sm:w-auto sm:flex-none`}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="unlinked">Unlinked</option>
          </select>
        </div>
      </header>

      <div className="space-y-5 p-4 sm:p-5">
        {error ? <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner> : null}
        {needsProfileRecovery(account) ? <LinkedAccountRecovery key={account.profileHealth?.recovery?.submittedAt ?? account.id} account={account} admin onChange={next => onChange(next)} /> : null}
        {due ? (
          <div className="flex items-start gap-2 rounded-[12px] border border-[#ecd8a8] bg-[#fff8e8] px-3.5 py-2.5 text-[12.5px] text-[#6b4a05]">
            <Icon d={ICONS.clock} className="mt-0.5 h-4 w-4 shrink-0" />
            {days === undefined ? account.sync.status === "error" ? "The platform has not returned readable statistics yet. Check the connection in Auto-sync above; retries are scheduled automatically. You can add private insights below." : "Waiting for the first automatic reading. Private insights can also be added below." : `Last check-in was ${days} days ago. Creators expect weekly updates.`}
          </div>
        ) : null}

        <section>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <SectionLabel>Latest numbers</SectionLabel>
            {latest ? <span className="text-[11.5px] text-[#7a827c]">{formatDateTime(latest.capturedAt)} · last {latest.periodDays} days</span> : null}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Followers", value: formatCompact(followers.value), sub: followers.change !== undefined ? `${followers.change >= 0 ? "+" : ""}${formatCompact(followers.change)} vs prev` : "" },
              ...(platform.id === "instagram" ? [
                { label: "Tracked reel views", value: formatCompact(reelViews.value), sub: reelViews.count ? `Public counts from ${reelViews.count} tracked posts` : account.posts.length ? "Instagram has not exposed views for these reels" : "Instagram has not exposed reel links; add one below" },
                { label: "Tracked reel likes", value: formatCompact(reelLikes.value), sub: reelLikes.count ? `Public counts from ${reelLikes.count} tracked posts` : "Read when exposed on public reel pages" },
              ] : []),
              { label: "Reach", value: formatCompact(latest?.reach), sub: "" },
              { label: "Engagement", value: formatPct(engagementRate(latest)), sub: "interactions ÷ reach" },
              earnings
                ? earnings.basis === "views"
                  ? { label: "Estimated view earnings", value: earnings.earned, sub: `${formatCompact(earnings.approvedViews)} approved views at ${earnings.rate} / 1,000${earnings.unmeasuredApproved ? ` · ${earnings.unmeasuredApproved} missing counts` : ""}${earnings.pending ? ` · ${earnings.pendingValue} in review` : ""}${earnings.unmeasuredPending ? ` · ${earnings.unmeasuredPending} pending counts` : ""}` }
                  : { label: "Approved reels", value: String(earnings.approved), sub: `${earnings.earned} owed at ${earnings.rate}${earnings.pending ? ` · ${earnings.pending} to review` : ""}` }
                : { label: "Approved reels", value: String(countedReels(account.posts, account.linkedAt).filter((p) => p.status === "approved").length), sub: account.payout ? `${account.payout}${account.payoutType ? ` · ${account.payoutType}` : ""}` : "" },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-[10px] border border-[#eef0ec] bg-[#fafbf9] px-3 py-2">
                <dt className="text-[11px] font-medium text-[#8a928c]">{item.label}</dt>
                <dd className="text-[16px] font-semibold tabular-nums text-[#1a201c]">{item.value}</dd>
                {item.sub ? <dd className="break-words text-[10.5px] leading-4 text-[#8a928c]">{item.sub}</dd> : null}
              </div>
            ))}
          </dl>
          {platform.id === "instagram" && latest?.note ? <p className="mt-2 text-[11.5px] leading-5 text-[#616a64]">{latest.note}</p> : null}
          {account.snapshots.length > 1 ? (
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {(["followers", "reach", "impressions", "engagements"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setChartMetric(m)}
                    className={`h-7 rounded-full border px-2.5 text-[11.5px] font-semibold ${chartMetric === m ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#d9ddd8] bg-white text-[#3b443e]"}`}
                  >
                    {SNAPSHOT_FIELDS.find((f) => f.key === m)?.label}
                  </button>
                ))}
              </div>
              <MetricChart points={metricSeries(account.snapshots, chartMetric, 0, now)} label={chartMetric} format={formatCompact} height={180} zeroBased={chartMetric !== "followers"} />
            </div>
          ) : null}
        </section>

        <CheckInForm key={account.id} account={account} screenshotReader={screenshotReader} onSaved={(snapshot) => onChange({ ...account, snapshots: [...account.snapshots, snapshot].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt)) })} />

        <section>
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Reels</SectionLabel>
            {!postEditor ? (
              <button type="button" className={btnGhost} onClick={() => setPostEditor({ post: null })}>
                <Icon d={ICONS.send} />
                Add reel
              </button>
            ) : null}
          </div>
          {postEditor ? (
            <div className="mt-2">
              <PostEditor
                key={postEditor.post?.id ?? "new"}
                account={account}
                editing={postEditor.post}
                screenshotReader={screenshotReader}
                onCancel={() => setPostEditor(null)}
                onSaved={(post) => {
                  onChange({ ...account, posts: [post, ...account.posts.filter((p) => p.id !== post.id && p.url !== post.url)] });
                  setPostEditor(null);
                }}
              />
            </div>
          ) : null}
          {account.posts.length ? (
            <ReelList
              account={account}
              now={now}
              busyId={busy}
              onReview={review}
              onEdit={(post) => setPostEditor({ post })}
              onRemove={async (post, reason, silent) => {
                const outcome = await reelAction<{ post: SocialPost; pendingClaims: number; mailStatus: { sent: boolean } | null }>(post.id, { action: "remove_post", id: post.id, reason: reason.trim() || undefined, silent });
                if ("error" in outcome) return outcome;
                replacePost(outcome.post);
                return { pendingClaims: outcome.pendingClaims ?? 0, emailed: outcome.mailStatus?.sent ?? false };
              }}
              onRestore={async (post) => {
                const outcome = await reelAction<{ post: SocialPost }>(post.id, { action: "restore_post", id: post.id });
                if ("error" in outcome) return outcome;
                replacePost(outcome.post);
                return { ok: true as const };
              }}
            />
          ) : !postEditor ? (
            <p className="mt-2 rounded-[12px] border border-dashed border-[#e3e5e1] px-3.5 py-3 text-[12.5px] text-[#7a827c]">No reels recorded yet. Add each reel the creator posts with its views and interactions.</p>
          ) : null}
        </section>

        {account.snapshots.length ? (
          <section>
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>Check-in history</SectionLabel>
              <button
                type="button"
                className={`${btnGhost} h-8 px-2.5 text-[12px]`}
                onClick={() => {
                  const header = ["captured_at", "period_days", ...SNAPSHOT_FIELDS.map((f) => f.key), "note"];
                  const escape = (v: unknown) => {
                    const text = v === undefined || v === null ? "" : String(v);
                    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
                  };
                  const rows = account.snapshots.map((snap) => [snap.capturedAt, snap.periodDays, ...SNAPSHOT_FIELDS.map((f) => snap[f.key]), snap.note ?? ""].map(escape).join(","));
                  const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" });
                  const href = URL.createObjectURL(blob);
                  const link = Object.assign(document.createElement("a"), { href, download: `${account.handle}-check-ins.csv` });
                  link.click();
                  URL.revokeObjectURL(href);
                }}
              >
                <Icon d={ICONS.download} className="h-3.5 w-3.5" />
                CSV
              </button>
            </div>
            <div className="mt-2 overflow-x-auto rounded-[12px] border border-[#e3e5e1]">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead className="bg-[#fafbf9] text-[11px] text-[#7a827c]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Captured</th>
                    {SNAPSHOT_FIELDS.map((f) => (
                      <th key={f.key} className="px-2 py-2 text-right font-medium">
                        {f.label.split(" ")[0]}
                      </th>
                    ))}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef0ec]">
                  {[...account.snapshots].reverse().map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-[#1a201c]" title={s.note || undefined}>
                        {formatDate(s.capturedAt)}
                        <span className="ml-1 text-[#8a928c]">· {s.periodDays}d</span>
                        {s.source !== "manual" ? (
                          <span className={`ml-1.5 rounded-[999px] px-1.5 py-px text-[10px] font-semibold ${(s.source === "api" || s.source === "profile") ? "bg-[#e6f0fb] text-[#1f4a73]" : "bg-[#f3ecfb] text-[#5b3a87]"}`}>
                            {(s.source === "api" || s.source === "profile") ? "Auto" : "Screenshot"}
                          </span>
                        ) : null}
                        {s.note ? <Icon d={ICONS.chat} className="ml-1 inline h-3 w-3 text-[#8a928c]" /> : null}
                      </td>
                      {SNAPSHOT_FIELDS.map((f) => (
                        <td key={f.key} className="px-2 py-2 text-right tabular-nums text-[#3b443e]">
                          {formatCompact(s[f.key])}
                        </td>
                      ))}
                      <td className="px-1 py-1 text-right">
                        <button
                          type="button"
                          className={btnIcon}
                          disabled={busy === s.id}
                          onClick={() => void run(s.id, { action: "delete_snapshot", id: s.id }, () => onChange({ ...account, snapshots: account.snapshots.filter((x) => x.id !== s.id) }))}
                          aria-label={`Delete check-in from ${formatDate(s.capturedAt)}`}
                          title="Delete"
                        >
                          {busy === s.id ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.x} className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
      {reportMissing ? <ConfirmDialog title={`Mark @${account.handle} as missing?`} body="Confirm that you opened the profile and it could not be found. This removes it from Linked and asks the creator to verify or correct it. Saved reels and earnings are retained." confirmLabel="I checked — profile not found" icon={ICONS.alert} busy={busy === "missing"} onCancel={() => setReportMissing(false)} onConfirm={() => { void run<{ account: LinkedSocialAccount }>("missing", { action: "report_missing_profile", accountId: account.id, notFoundConfirmed: true }, payload => { onChange(payload.account); setReportMissing(false); }); }} /> : null}
    </article>
  );
}

export default function LinkedAccountsPanel({ isDesktop, adminId }: { isDesktop: boolean; adminId: string }) {
  const [filter, setFilter] = useState<Filter>(() => readAdminFilter());
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<Error | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const read = useCallback(async (signal: AbortSignal, sync = false) => {
    const res = await fetch(`/api/social-accounts?scope=all${sync ? "&sync=1" : ""}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    const payload = await res.json().catch(() => null);
    if ((res.status === 401 || res.status === 403) && !signal.aborted && isCurrentAdminCacheIdentity(adminId)) {
      adminSessionCache.clear(adminId);
      window.dispatchEvent(new Event("admin-auth-invalidated"));
    }
    if (!res.ok) throw Object.assign(new Error(payload?.error || "Linked accounts couldn't be refreshed."), { unavailable: payload?.code === "schema_outdated" });
    return linkedAccountsData(payload);
  }, [adminId]);
  const resource = useAdminCachedResource<LinkedAccountsData>({
    scope: adminId, key: LINKED_ACCOUNTS_CACHE_KEY, load: read,
    ttlMs: LINKED_ACCOUNTS_FRESH_MS, maxAgeMs: 15 * 60_000, persist: true, validate: isLinkedAccountsData,
  });
  const { refresh: refreshSaved, update: updateSaved } = resource;
  const accounts = resource.data?.accounts ?? null;
  const screenshotReader = resource.data?.screenshotReader ?? false;
  const error = resource.error ?? syncError;
  const loading = resource.refreshing || syncing || resource.loading;

  const syncAccounts = useCallback(async (force = false) => {
    if (!isCurrentAdminCacheIdentity(adminId) || document.hidden || !navigator.onLine) return;
    const lastAttempt = adminSessionCache.read<{ at: number }>(adminId, LINKED_SYNC_ATTEMPT_KEY, { maxAgeMs: 30 * 60_000, validate: isLinkedSyncAttempt })?.data.at;
    if (!linkedSyncDue(lastAttempt, Date.now(), force)) return;
    adminSessionCache.write(adminId, LINKED_SYNC_ATTEMPT_KEY, { at: Date.now() }, { persist: true });
    if (mounted.current) { setSyncing(true); setSyncError(null); }
    try {
      const data = await adminSessionCache.load(adminId, LINKED_SYNC_CACHE_KEY, signal => read(signal, true), { force: true, validate: isLinkedAccountsData });
      // Confirmed sync wins over any older saved-data read still in flight.
      updateSaved(data);
      if (mounted.current) setNow(Date.now());
    } catch (error) {
      if (mounted.current && !(error instanceof Error && error.name === "AbortError")) setSyncError(error instanceof Error ? error : new Error("Profile checks couldn't finish. Saved data is still shown."));
    } finally { if (mounted.current) setSyncing(false); }
  }, [adminId, read, updateSaved]);
  const refreshVisible = useCallback(async () => {
    if (!navigator.onLine) return;
    const data = await refreshSaved({ force: false });
    if (data && mounted.current) { setNow(Date.now()); void syncAccounts(); }
  }, [refreshSaved, syncAccounts]);
  // Check deadlines frequently; database leases and per-account schedules bound platform traffic.
  useVisibleRefresh(refreshVisible, 30_000);
  useEffect(() => {
    const refresh = () => { void syncAccounts(true); };
    const live = (event: Event) => {
      const kinds = (event as CustomEvent<AdminLiveKind[] | null>).detail;
      if (!kinds) void refreshSaved({ force: false });
      else if (kinds.some(kind => ["gig_applications", "social_account_requests", "linked_social_accounts", "social_account_snapshots", "social_account_posts"].includes(kind))) void refreshSaved({ force: true, afterCurrent: true });
    };
    const online = () => { void refreshVisible(); };
    window.addEventListener("admin-refresh", refresh);
    window.addEventListener("admin-live", live);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("admin-refresh", refresh);
      window.removeEventListener("admin-live", live);
      window.removeEventListener("online", online);
    };
  }, [refreshSaved, refreshVisible, syncAccounts]);
  const refreshAll = () => {
    window.dispatchEvent(new Event("admin-linked-accounts-refresh"));
    void syncAccounts(true);
  };

  const counts = useMemo(() => {
    const list = accounts ?? [];
    return {
      all: list.length,
      attention: list.filter(needsProfileRecovery).length,
      due: list.filter((a) => isDue(a, now)).length,
      reels: list.filter((a) => toReview(a) > 0).length,
      active: list.filter((a) => a.status === "active").length,
      paused: list.filter((a) => a.status === "paused").length,
      unlinked: list.filter((a) => a.status === "unlinked").length,
    } satisfies Record<Filter, number>;
  }, [accounts, now]);

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (accounts ?? [])
      .filter((a) =>
        filter === "all"
          ? a.status !== "unlinked"
          : filter === "attention"
            ? needsProfileRecovery(a)
          : filter === "due"
            ? isDue(a, now)
            : filter === "reels"
              ? toReview(a) > 0
              : a.status === filter,
      )
      .filter((a) => !text || [a.handle, a.gigTitle, a.company, a.workerCode, a.platform].some((v) => String(v ?? "").toLowerCase().includes(text)))
      // Most overdue first, so the queue doubles as a to-do list.
      .sort((a, b) => (daysSinceSnapshot(b.snapshots, now) ?? 9999) - (daysSinceSnapshot(a.snapshots, now) ?? 9999));
  }, [accounts, filter, query, now]);

  const selected = visible.find((a) => a.id === selectedId) ?? (isDesktop ? visible[0] : undefined);
  const update = (next: LinkedSocialAccount) => {
    window.dispatchEvent(new Event("admin-overview-refresh"));
    adminSessionCache.invalidate(adminId, LINKED_SYNC_CACHE_KEY);
    updateSaved(previous => linkedAccountsData({
      accounts: (previous?.accounts ?? accounts ?? []).map(account => account.id === next.id ? next : account),
      screenshotReader: previous?.screenshotReader ?? screenshotReader,
    }));
  };

  const select = (id: string) => {
    setSelectedId(id);
    if (!isDesktop) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#1a201c] sm:text-[24px]">Linked accounts</h1>
          <p className="mt-1 max-w-[70ch] text-[13px] text-[#616a64]">
            Linked accounts refresh automatically on their own schedules. Track connection health, upcoming retries and the last successful reading. Add private insights from screenshots or check-ins; creators see saved updates in their dashboard.
          </p>
        </div>
        <button type="button" className={`${btnGhost} self-start sm:self-auto`} onClick={refreshAll} disabled={loading}>
          {loading ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.refresh} />}
          Refresh
        </button>
      </div>

      <AccountRequestsQueue adminId={adminId} onLinked={() => {
        adminSessionCache.invalidate(adminId, LINKED_SYNC_CACHE_KEY);
        void refreshSaved({ force: true, afterCurrent: true });
      }} />

      <AutoSyncCard adminId={adminId} onChanged={() => {
        adminSessionCache.invalidate(adminId, LINKED_SYNC_CACHE_KEY);
        void syncAccounts(true);
      }} />

      {error ? (
        <Banner tone="danger"><div className="flex flex-wrap items-center justify-between gap-3"><span>{(error as Error & { unavailable?: boolean }).unavailable ? "Linked accounts need the latest database update." : error.message}{accounts ? " Saved data is still shown." : ""}</span><button type="button" className="rounded-lg border border-current px-3 py-1.5 font-semibold" onClick={() => { setSyncError(null); void refreshSaved({ force: true }); }}>Retry</button></div></Banner>
      ) : null}

      <div className={`${cardClass} flex flex-col gap-2.5 p-2.5 xl:flex-row xl:items-center`}>
        <div className="dashboard-chip-scroller flex min-w-0 gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => { setFilter(f.id); saveAdminFilter(f.id); }}
              aria-pressed={filter === f.id}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-semibold transition ${
                filter === f.id ? "bg-[#1f2b24] text-white" : "text-[#4b544e] hover:bg-[#f1f3f0]"
              }`}
            >
              {f.label}
              <span
                className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${filter === f.id ? "bg-white/20" : (f.id === "due" || f.id === "reels") && counts[f.id] ? "bg-[#fdf1dc] text-[#9a5b00]" : "bg-[#eef0ed]"}`}
              >
                {accounts === null ? "–" : counts[f.id]}
              </span>
            </button>
          ))}
        </div>
        <label className="relative min-w-0 xl:ml-auto xl:w-64 xl:shrink-0">
          <span className="sr-only">Search accounts</span>
          <Icon d={ICONS.search} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a928c]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search handle, gig, creator" className={`${fieldClass} h-9 pl-8`} />
        </label>
      </div>

      {accounts === null && !error ? (
        <AdminSectionLoading label="Loading saved accounts" />
      ) : accounts && !visible.length ? (
        <EmptyState
          icon={ICONS.user}
          title={accounts.length ? "Nothing matches" : "No linked accounts yet"}
          body={accounts.length ? "Try another filter or search." : "Approve a Content Posting application with a verified account and it appears here."}
        />
      ) : accounts ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <ul
            className={`${cardClass} divide-y divide-[#eef0ec] overflow-hidden xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto xl:overscroll-contain ${
              selected && !isDesktop ? "hidden" : ""
            }`}
          >
            {visible.map((account) => {
              const followers = metricChange(account.snapshots, "followers").value;
              const active = selected?.id === account.id;
              return (
                <li key={account.id}>
                  <button
                    type="button"
                    onClick={() => select(account.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition ${active ? "bg-[#f1f5f0] shadow-[inset_3px_0_0_#1f2b24]" : "hover:bg-[#fafbf9]"}`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#eef1ed] text-[#2b5d4a]">
                      <PlatformGlyph platform={accountPlatformFor(account.platform)} className="h-4.5 w-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13.5px] font-semibold text-[#1a201c]">@{account.handle}</span>
                        <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[#3b443e]">{followers !== undefined ? formatCompact(followers) : "–"}</span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2 text-[11.5px]">
                        <span className="truncate text-[#7a827c]">
                          {toReview(account) ? (
                            <span className="mr-1 font-semibold text-[#9a5b00]">{toReview(account)} to review ·</span>
                          ) : null}
                          {account.gigTitle ?? account.gigId}
                        </span>
                        <SocialSyncStatus account={account} now={now} compact />
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div ref={detailRef} className="min-w-0 scroll-mt-20">
            {selected ? (
              <AccountDetail key={selected.id} account={selected} now={now} screenshotReader={screenshotReader} onChange={update} onBack={isDesktop ? undefined : () => setSelectedId(null)} />
            ) : (
              <p className="hidden rounded-[14px] border border-dashed border-[#e3e5e1] px-4 py-10 text-center text-[13px] text-[#7a827c] xl:block">Select an account to record its numbers.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
