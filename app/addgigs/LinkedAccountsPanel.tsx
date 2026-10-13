"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useVisibleRefresh } from "@/lib/useVisibleRefresh";
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
import AccountRequestsQueue from "./AccountRequestsQueue";
import PlatformGlyph from "../dashboard/PlatformGlyph";
import { Banner, EmptyState, ICONS, Icon, SectionLabel, Spinner, StatusChip, btnGhost, btnIcon, btnPrimary, cardClass, fieldClass, formatDate, formatDateTime, formatRelative } from "./adminUi";

// Admin: every account linked after Content Posting screening. The team logs in, reads the platform's insights and
// records them here as check-ins; creators see the result in Dashboard → Accounts.

type Filter = "all" | "due" | "reels" | "active" | "paused" | "unlinked";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
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
  if (account.sync.available && account.sync.status === "ok") return false;
  const days = daysSinceSnapshot(account.snapshots, now);
  return days === undefined || days >= STALE_AFTER_DAYS;
};
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
          <input type="date" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} className={`${fieldClass} mt-1 h-10`} />
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
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);
  const review = async (post: SocialPost, status: "approved" | "rejected", note?: string) => {
    setBusy(post.id);
    setError(null);
    try {
      const { post: updated } = await adminPost<{ post: SocialPost }>({ action: "review_post", id: post.id, status, note });
      onChange({ ...account, posts: account.posts.map((p) => (p.id === post.id ? updated : p)) });
      setRejecting(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The review couldn't be saved.");
    } finally {
      setBusy(null);
    }
  };
  // Creators' submissions first, then newest.
  const orderedPosts = [...account.posts].sort((a, b) => Number(b.status === "submitted") - Number(a.status === "submitted"));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = account.snapshots.at(-1);
  const followers = metricChange(account.snapshots, "followers");
  const observedTotal = (key: "views" | "likes") => {
    const measured = account.posts.filter((post) => typeof post[key] === "number");
    return { value: measured.length ? measured.reduce((sum, post) => sum + (post[key] ?? 0), 0) : undefined, count: measured.length };
  };
  const reelViews = observedTotal("views");
  const reelLikes = observedTotal("likes");
  const earnings = reelEarnings(account);
  const due = isDue(account, now);
  const days = daysSinceSnapshot(account.snapshots, now);

  const run = async (key: string, body: Record<string, unknown>, apply: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await adminPost(body);
      apply();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change couldn't be saved.");
    } finally {
      setBusy(null);
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
          <p className="mt-0.5 text-[11.5px] text-[#8a928c]">
            Linked {formatDate(account.linkedAt)} ·{" "}
            {account.sync.available ? (
              <span className={account.sync.status === "error" ? "font-semibold text-[#9a5b00]" : "text-[#2e7d4f]"}>
                {account.sync.status === "error"
                  ? `Sync failed: ${account.sync.error ?? "unknown error"}`
                  : account.sync.lastSyncedAt
                    ? `Auto-synced ${formatRelative(account.sync.lastSyncedAt)}`
                    : "Auto-sync pending"}
              </span>
            ) : account.sync.status === "not_configured" ? (
              "Auto-sync not connected (see Auto-sync above)"
            ) : (
              "Manual check-ins only for this platform"
            )}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {account.sync.available ? (
            <button
              type="button"
              className={`${btnGhost} flex-1 sm:flex-none`}
              disabled={busy === "sync"}
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
              Sync now
            </button>
          ) : null}
          <a href={`/addgigs/applications?gig=${encodeURIComponent(account.gigId)}`} className={`${btnGhost} flex-1 sm:flex-none`} title="Login details are on the application">
            <Icon d={ICONS.lock} />
            Login details
          </a>
          <label className="sr-only" htmlFor={`status-${account.id}`}>
            Account status
          </label>
          <select
            id={`status-${account.id}`}
            value={account.status}
            disabled={busy === "status"}
            onChange={(e) => {
              const status = e.target.value as SocialAccountStatus;
              void run("status", { action: "status", accountId: account.id, status }, () => onChange({ ...account, status }));
            }}
            className={`${fieldClass} h-9 w-auto flex-1 sm:flex-none`}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="unlinked">Unlinked</option>
          </select>
        </div>
      </header>

      <div className="space-y-5 p-4 sm:p-5">
        {error ? <Banner tone="danger" onDismiss={() => setError(null)}>{error}</Banner> : null}
        {due ? (
          <div className="flex items-start gap-2 rounded-[12px] border border-[#ecd8a8] bg-[#fff8e8] px-3.5 py-2.5 text-[12.5px] text-[#6b4a05]">
            <Icon d={ICONS.clock} className="mt-0.5 h-4 w-4 shrink-0" />
            {days === undefined ? "No numbers recorded yet. Public profile sync runs automatically; private insights can be added below." : `Last check-in was ${days} days ago. Creators expect weekly updates.`}
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
                : { label: "Approved reels", value: String(account.posts.filter((p) => p.status === "approved").length), sub: account.payout ? `${account.payout}${account.payoutType ? ` · ${account.payoutType}` : ""}` : "" },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-[10px] border border-[#eef0ec] bg-[#fafbf9] px-3 py-2">
                <dt className="text-[11px] font-medium text-[#8a928c]">{item.label}</dt>
                <dd className="text-[16px] font-semibold tabular-nums text-[#1a201c]">{item.value}</dd>
                {item.sub ? <dd className="truncate text-[10.5px] text-[#8a928c]">{item.sub}</dd> : null}
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
            <ul className="mt-2 divide-y divide-[#eef0ec] overflow-hidden rounded-[12px] border border-[#e3e5e1]">
              {orderedPosts.map((post) => (
                <li key={post.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 ${post.status === "submitted" ? "bg-[#fffaf0]" : ""}`}>
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <a href={post.url} target="_blank" rel="noreferrer" className="truncate text-[13px] font-semibold text-[#1a201c] underline-offset-2 hover:underline">
                        {post.caption || post.url}
                      </a>
                      {(post.source === "api" || post.source === "profile") ? <StatusChip label="Auto" tone="info" /> : null}
                      {post.status !== "approved" ? <StatusChip label={post.status === "submitted" ? "To review" : "Rejected"} tone={post.status === "submitted" ? "warning" : "danger"} /> : null}
                    </div>
                    <div className="text-[11.5px] text-[#8a928c]">
                      {post.postedAt ? formatDate(post.postedAt) : "No date"}
                      {post.submittedByWorker ? ` · sent by creator ${formatRelative(post.createdAt)}` : (post.source === "api" || post.source === "profile") ? ` · found by sync, updated ${formatRelative(post.updatedAt)}` : ` · updated ${formatRelative(post.updatedAt)}`}
                    </div>
                    {post.status === "rejected" && post.reviewNote ? <div className="mt-0.5 truncate text-[11.5px] text-[#b42318]">Note: {post.reviewNote}</div> : null}
                  </div>
                  <div className={`gap-3 text-[12px] tabular-nums text-[#3b443e] ${post.views === undefined && post.likes === undefined && post.comments === undefined ? "hidden" : "flex"}`}>
                    <span title="Views">▶ {formatCompact(post.views)}</span>
                    <span title="Likes">♥ {formatCompact(post.likes)}</span>
                    <span title="Comments">💬 {formatCompact(post.comments)}</span>
                  </div>
                  {post.status === "submitted" ? (
                    <div className="flex w-full gap-1.5 sm:w-auto">
                      <button type="button" className={`${btnPrimary} h-8 flex-1 px-2.5 text-[12px] sm:flex-none`} disabled={busy === post.id} onClick={() => void review(post, "approved")}>
                        {busy === post.id ? <Spinner /> : <Icon d={ICONS.check} className="h-3.5 w-3.5" />}
                        Approve
                      </button>
                      <button type="button" className={`${btnGhost} h-8 flex-1 px-2.5 text-[12px] sm:flex-none`} disabled={busy === post.id} onClick={() => setRejecting({ id: post.id, note: "" })}>
                        Reject
                      </button>
                    </div>
                  ) : null}
                  {rejecting?.id === post.id ? (
                    <div className="flex w-full flex-col gap-2 sm:flex-row">
                      <input
                        autoFocus
                        value={rejecting.note}
                        maxLength={500}
                        onChange={(e) => setRejecting({ id: post.id, note: e.target.value })}
                        placeholder="Why? The creator sees this (e.g. posted on a different account)"
                        className={`${fieldClass} h-9 flex-1`}
                      />
                      <div className="flex gap-1.5">
                        <button type="button" className={`${btnGhost} h-9 flex-1`} onClick={() => setRejecting(null)}>
                          Cancel
                        </button>
                        <button type="button" className={`${btnPrimary} h-9 flex-1 bg-[#b42318] hover:bg-[#9a1e14]`} disabled={!rejecting.note.trim() || busy === post.id} onClick={() => void review(post, "rejected", rejecting.note)}>
                          Reject reel
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="flex gap-1">
                    <button type="button" className={btnIcon} onClick={() => setPostEditor({ post })} aria-label="Update numbers" title="Update numbers">
                      <Icon d={ICONS.refresh} />
                    </button>
                    <button
                      type="button"
                      className={btnIcon}
                      disabled={busy === post.id}
                      onClick={() => void run(post.id, { action: "delete_post", id: post.id }, () => onChange({ ...account, posts: account.posts.filter((p) => p.id !== post.id) }))}
                      aria-label="Remove reel"
                      title="Remove"
                    >
                      {busy === post.id ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.x} />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
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
    </article>
  );
}

export default function LinkedAccountsPanel({ isDesktop }: { isDesktop: boolean }) {
  const [accounts, setAccounts] = useState<LinkedSocialAccount[] | null>(null);
  const [screenshotReader, setScreenshotReader] = useState(false);
  const [error, setError] = useState<{ message: string; unavailable: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const detailRef = useRef<HTMLDivElement>(null);
  const requestRunning = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (requestRunning.current) return;
    requestRunning.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/social-accounts?scope=all&sync=1", { signal: AbortSignal.timeout(20_000) });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw Object.assign(new Error(payload?.error || "Linked accounts couldn't be loaded."), { unavailable: payload?.code === "schema_outdated" });
      setAccounts(payload?.accounts ?? []);
      setScreenshotReader(payload?.screenshotReader === true);
      setError(null);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Linked accounts couldn't be loaded.", unavailable: !!(e as { unavailable?: boolean }).unavailable });
    } finally {
      requestRunning.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  const refreshVisible = useCallback(async () => { await load(true); }, [load]);
  useVisibleRefresh(refreshVisible, 5 * 60_000);

  const counts = useMemo(() => {
    const list = accounts ?? [];
    return {
      all: list.length,
      due: list.filter((a) => isDue(a, now)).length,
      reels: list.filter((a) => a.posts.some((p) => p.status === "submitted")).length,
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
          : filter === "due"
            ? isDue(a, now)
            : filter === "reels"
              ? a.posts.some((p) => p.status === "submitted")
              : a.status === filter,
      )
      .filter((a) => !text || [a.handle, a.gigTitle, a.company, a.workerCode, a.platform].some((v) => String(v ?? "").toLowerCase().includes(text)))
      // Most overdue first, so the queue doubles as a to-do list.
      .sort((a, b) => (daysSinceSnapshot(b.snapshots, now) ?? 9999) - (daysSinceSnapshot(a.snapshots, now) ?? 9999));
  }, [accounts, filter, query, now]);

  const selected = visible.find((a) => a.id === selectedId) ?? (isDesktop ? visible[0] : undefined);
  const update = (next: LinkedSocialAccount) => setAccounts((prev) => (prev ?? []).map((a) => (a.id === next.id ? next : a)));

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
            Accounts creators set up for Content Posting gigs, linked when you approve them. Instagram reads public profiles automatically. Other connected platforms sync by themselves; add private insights from screenshots or weekly check-ins. Updates refresh every 30 seconds while this page is open. Creators see everything in their dashboard.
          </p>
        </div>
        <button type="button" className={`${btnGhost} self-start sm:self-auto`} onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.refresh} />}
          Refresh
        </button>
      </div>

      <AccountRequestsQueue onLinked={() => void load(true)} />

      <AutoSyncCard onChanged={() => void load()} />

      {error ? (
        <Banner tone="danger">{error.unavailable ? "Linked accounts need the latest database migration. Run npm run db:migrate, then refresh." : error.message}</Banner>
      ) : null}

      <div className={`${cardClass} flex flex-col gap-2.5 p-2.5 sm:flex-row sm:items-center`}>
        <div className="dashboard-chip-scroller flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-semibold transition ${
                filter === f.id ? "bg-[#1f2b24] text-white" : "text-[#4b544e] hover:bg-[#f1f3f0]"
              }`}
            >
              {f.label}
              <span
                className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${filter === f.id ? "bg-white/20" : (f.id === "due" || f.id === "reels") && counts[f.id] ? "bg-[#fdf1dc] text-[#9a5b00]" : "bg-[#eef0ed]"}`}
              >
                {counts[f.id]}
              </span>
            </button>
          ))}
        </div>
        <label className="relative min-w-0 flex-1 sm:max-w-xs sm:ml-auto">
          <span className="sr-only">Search accounts</span>
          <Icon d={ICONS.search} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a928c]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search handle, gig, creator" className={`${fieldClass} h-9 pl-8`} />
        </label>
      </div>

      {accounts === null && !error ? (
        <div className="grid place-items-center py-16">
          <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" />
        </div>
      ) : accounts && !visible.length ? (
        <EmptyState
          icon={ICONS.user}
          title={accounts.length ? "Nothing matches" : "No linked accounts yet"}
          body={accounts.length ? "Try another filter or search." : "Approve a Content Posting application with a verified account and it appears here."}
        />
      ) : accounts ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <ul
            className={`${cardClass} divide-y divide-[#eef0ec] overflow-hidden lg:sticky lg:top-[8.5rem] lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto ${
              selected && !isDesktop ? "hidden" : ""
            }`}
          >
            {visible.map((account) => {
              const days = daysSinceSnapshot(account.snapshots, now);
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
                          {account.posts.some((p) => p.status === "submitted") ? (
                            <span className="mr-1 font-semibold text-[#9a5b00]">{account.posts.filter((p) => p.status === "submitted").length} to review ·</span>
                          ) : null}
                          {account.gigTitle ?? account.gigId}
                        </span>
                        <span className={`shrink-0 ${isDue(account, now) ? "font-semibold text-[#9a5b00]" : "text-[#8a928c]"}`}>
                          {account.status !== "active" ? account.status : days === undefined ? "No check-ins" : days === 0 ? "Today" : `${days}d ago`}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div ref={detailRef} className="min-w-0 scroll-mt-28">
            {selected ? (
              <AccountDetail key={selected.id} account={selected} now={now} screenshotReader={screenshotReader} onChange={update} onBack={isDesktop ? undefined : () => setSelectedId(null)} />
            ) : (
              <p className="hidden rounded-[14px] border border-dashed border-[#e3e5e1] px-4 py-10 text-center text-[13px] text-[#7a827c] lg:block">Select an account to record its numbers.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
