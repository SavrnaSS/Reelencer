"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api/client";
import { safeWorkerCsvCell, type WorkerDirectoryRecord } from "@/lib/adminWorkerDirectory";
import { BROADCAST_KIND_LABELS, BROADCAST_LIMITS, BROADCAST_TOKENS, SAMPLE_VARS, broadcastTemplate, fillTokens, followUpTemplate, hasFollowUp, isPromotional, type BroadcastContent, type BroadcastGig, type BroadcastKind } from "@/lib/broadcastEmail";
import { ACTIVITY_PRESETS, activeActivityFilterCount, type ActivityFilters } from "@/lib/workerActivity";

// Bulk email to users picked in the Workers directory: write it (from a template), see the real email, review who
// gets it and who's skipped, then send in chunks with live progress. The server decides the recipients and their
// addresses; this only sends worker IDs.

type Audience = "selected" | "filtered" | `preset:${string}`;
/** A quick view from the Workers directory, with the people currently in it. */
export type AudiencePreset = { id: string; label: string; workers: WorkerDirectoryRecord[]; filters: ActivityFilters };
type Skip = { workerId: string; name: string; reason: string };
type Prepared = { id: string | null; recipients: number; chunk: number; skipped: Skip[] };
type Outcome = { workerId: string; name: string; ok: boolean; error?: string };
type HistoryRow = { id: string; kind: BroadcastKind; subject: string; recipients: number; sent: number; failed: number; skipped: number; status: string; createdAt: string };
type Stage = "compose" | "review" | "sending" | "done";

const SKIP_LABELS: Record<string, string> = {
  no_email: "No email address", deleted: "Deleted account", suspended: "Suspended (promotions only)", unsubscribed: "Unsubscribed from promotions",
  bounced: "Address bounced", complained: "Marked earlier email as spam", duplicate: "Same email as another user",
};
const KINDS: BroadcastKind[] = ["reminder", "terms", "promotion", "announcement"];
const KIND_HINTS: Record<BroadcastKind, string> = {
  terms: "A service notice. Goes to every selected creator, including suspended ones.",
  reminder: "About each person's own application: their gig, @handle and bio code are filled in for them. Skips suspended users.",
  promotion: "Promotional. Skips suspended users and anyone who unsubscribed.",
  announcement: "Promotional. Skips suspended users and anyone who unsubscribed.",
};

const inputCls = "h-10 w-full min-w-0 rounded-xl border border-[#d9ddd8] bg-white px-3 text-[16px] text-[#1a201c] outline-none transition placeholder:text-[#9aa29c] focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20 sm:text-[13.5px]";
const primaryBtn = "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#1f2b24] px-4 text-[13.5px] font-semibold text-white transition hover:bg-[#2b3a31] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtn = "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#d9ddd8] bg-white px-4 text-[13.5px] font-semibold text-[#1a201c] transition hover:bg-[#f7f8f6] disabled:opacity-50";

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) throw new Error(typeof payload?.error === "string" ? payload.error : "Something went wrong. Please try again.");
  return payload;
}

const when = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "";

function Field({ label, hint, count, children }: { label: string; hint?: string; count?: [number, number]; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-[12.5px] font-semibold text-[#3b443e]">
        {label}
        {count ? <span className={`text-[11px] font-medium tabular-nums ${count[0] > count[1] ? "text-[#b42318]" : "text-[#9aa29c]"}`}>{count[0]}/{count[1]}</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11.5px] leading-[1.1rem] text-[#7a827c]">{hint}</span> : null}
    </label>
  );
}

type Device = "desktop" | "phone";
type Theme = "light" | "dark";

/**
 * The email in an isolated frame, laid out as an inbox would: 640px wide scaled to fit for desktop, or a 390px phone.
 * The email follows the reader's light or dark mode; the toggle forces one so both can be checked.
 */
function EmailPreviewFrame({ html, device, theme }: { html: string; device: Device; theme: Theme }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const frameWidth = device === "desktop" ? 640 : 390;
  const gutter = device === "phone" ? 24 : 0;
  const scale = size.width ? Math.min(1, (size.width - gutter) / frameWidth) : 1;
  const doc = useMemo(() => {
    const scheme = html.replace(/content="light dark"/g, `content="${theme}"`);
    return scheme.replace(/@media \(prefers-color-scheme: dark\)/g, theme === "dark" ? "@media all" : "@media (prefers-color-scheme: reelencer-never)");
  }, [html, theme]);
  const top = device === "phone" ? 12 : 0;
  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-[#eef0ed]">
      {size.width ? (
        <div
          className={device === "phone" ? "overflow-hidden rounded-[22px] shadow-[0_12px_30px_-12px_rgba(15,26,19,0.35)] ring-1 ring-black/10" : ""}
          style={{ position: "absolute", top, left: Math.max(0, (size.width - frameWidth * scale) / 2), width: frameWidth, height: Math.max(0, (size.height - top * 2) / scale), transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <iframe title="Email preview" sandbox="" srcDoc={doc} className="h-full w-full border-0" style={{ background: theme === "dark" ? "#0f1411" : "#ffffff" }} />
        </div>
      ) : null}
    </div>
  );
}

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (value: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-[#f1f3f0] p-0.5">
      {options.map(([option, text]) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)} className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition ${value === option ? "bg-white text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.1)]" : "text-[#616a64] hover:text-[#1a201c]"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

export default function BroadcastComposer({ selected, filtered, presets, filters, activePresetId, onClose }: {
  selected: WorkerDirectoryRecord[];
  filtered: WorkerDirectoryRecord[];
  /** Quick views with their people, to pick an audience in one tap. */
  presets: AudiencePreset[];
  /** The directory's application filters, so each person's details come from the application they matched on. */
  filters: ActivityFilters;
  /** The quick view open in the directory, if any: its follow-up is the starting email. */
  activePresetId: string | null;
  onClose: () => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<"compose" | "history">("compose");
  const [audience, setAudience] = useState<Audience>(selected.length ? "selected" : activePresetId ? `preset:${activePresetId}` : "filtered");
  const [content, setContent] = useState<BroadcastContent>(() => (hasFollowUp(activePresetId) && !selected.length ? followUpTemplate(activePresetId!) : broadcastTemplate("terms")) as BroadcastContent);
  const [followUp, setFollowUp] = useState<string>(activePresetId && hasFollowUp(activePresetId) ? activePresetId : "pending");
  const [gigs, setGigs] = useState<BroadcastGig[] | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"edit" | "preview">("edit");
  const [device, setDevice] = useState<Device>("desktop");
  const [theme, setTheme] = useState<Theme>("light");
  const [test, setTest] = useState<{ state: "idle" | "sending" | "sent" | "failed"; text?: string }>({ state: "idle" });
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [stage, setStage] = useState<Stage>("compose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [stopped, setStopped] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const stopRef = useRef(false);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const audiencePreset = audience.startsWith("preset:") ? presets.find(preset => `preset:${preset.id}` === audience) : undefined;
  const audienceRows = audience === "selected" ? selected : audiencePreset ? audiencePreset.workers : filtered;
  // Which application each person's details come from: the quick view's, or the directory's filters.
  const audienceFilters = audiencePreset ? audiencePreset.filters : activeActivityFilterCount(filters) ? filters : undefined;
  const audienceLabel = audience === "selected" ? "Selected users" : audiencePreset ? audiencePreset.label : "Everyone in this view";
  const recipientIds = useMemo(() => audienceRows.slice(0, BROADCAST_LIMITS.recipients).map(worker => worker.id), [audienceRows]);
  const overLimit = audienceRows.length > BROADCAST_LIMITS.recipients;
  const sent = outcomes.filter(outcome => outcome.ok).length;
  const failed = outcomes.length - sent;
  const total = prepared?.recipients ?? 0;
  const tooLong = content.subject.length > BROADCAST_LIMITS.subject || content.title.length > BROADCAST_LIMITS.title || content.message.length > BROADCAST_LIMITS.message;
  const ready = !!content.subject.trim() && !!content.title.trim() && !!content.message.trim() && !tooLong && recipientIds.length > 0 && (content.kind !== "promotion" || !!content.gig);

  // Esc closes (not mid-send); focus starts in the dialog and the page behind doesn't scroll.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && stage !== "sending") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [onClose, stage]);

  // Open gigs for the promotion picker.
  useEffect(() => {
    if (content.kind !== "promotion" || gigs) return;
    let alive = true;
    void apiFetch("/api/gigs").then(readJson).then((rows: Array<BroadcastGig & { status?: string }>) => {
      if (alive) setGigs((Array.isArray(rows) ? rows : []).filter(gig => gig.status === "Open").map(({ id, title, company, payout, payoutType, platform }) => ({ id, title, company, payout, payoutType, platform })));
    }).catch(() => { if (alive) setGigs([]); });
    return () => { alive = false; };
  }, [content.kind, gigs]);

  // The real email, re-rendered by the server shortly after each edit.
  useEffect(() => {
    if (tab !== "compose" || stage !== "compose") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void apiFetch("/api/admin/broadcasts", { method: "POST", body: JSON.stringify({ action: "preview", content }), signal: controller.signal })
        .then(readJson)
        .then(payload => { setPreviewHtml(String(payload.html ?? "")); setPreviewError(null); })
        .catch(e => { if (!controller.signal.aborted) setPreviewError(e instanceof Error ? e.message : "Preview unavailable."); });
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [content, tab, stage]);

  const loadHistory = useCallback(async () => {
    try { setHistory(((await readJson(await apiFetch("/api/admin/broadcasts"))).broadcasts ?? []) as HistoryRow[]); }
    catch { setHistory([]); }
  }, []);
  useEffect(() => { if (tab === "history") void loadHistory(); }, [tab, loadHistory]);

  const setKind = (kind: BroadcastKind) => setContent((kind === "reminder" ? followUpTemplate(followUp) : broadcastTemplate(kind, kind === "promotion" ? content.gig : null)) as BroadcastContent);
  const chooseFollowUp = (presetId: string) => { setFollowUp(presetId); setContent(followUpTemplate(presetId)); };
  /** Picking a quick view targets its people and starts from its follow-up. */
  const choosePreset = (preset: AudiencePreset) => {
    setAudience(`preset:${preset.id}`);
    if (hasFollowUp(preset.id)) chooseFollowUp(preset.id);
  };
  const setGig = (gigId: string) => {
    const gig = gigs?.find(item => item.id === gigId) ?? null;
    setContent(broadcastTemplate("promotion", gig) as BroadcastContent);
  };
  const edit = (patch: Partial<BroadcastContent>) => setContent(previous => ({ ...previous, ...patch }));

  const review = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await readJson(await apiFetch("/api/admin/broadcasts", { method: "POST", body: JSON.stringify({ action: "prepare", content, workerIds: recipientIds, ...(audienceFilters ? { filters: audienceFilters } : {}), segment: audienceLabel }) }));
      setPrepared({ id: payload.id ?? null, recipients: Number(payload.recipients ?? 0), chunk: Number(payload.chunk ?? BROADCAST_LIMITS.chunk), skipped: Array.isArray(payload.skipped) ? payload.skipped : [] });
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't prepare this email.");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!prepared?.id || busy) return;
    setBusy(true);
    setError(null);
    setStage("sending");
    stopRef.current = false;
    setStopped(false);
    setStopRequested(false);
    setOutcomes([]);
    for (let offset = 0; offset < prepared.recipients; offset += prepared.chunk) {
      if (stopRef.current) { setStopped(true); break; }
      let attempt = 0;
      for (;;) {
        try {
          const payload = await readJson(await apiFetch("/api/admin/broadcasts", { method: "POST", body: JSON.stringify({ action: "send", id: prepared.id, offset }) }));
          setOutcomes(previous => [...previous, ...((payload.results ?? []) as Outcome[])]);
          break;
        } catch (e) {
          // The server sends each chunk once per recipient (idempotent), so retrying a failed request is safe.
          if (++attempt >= 3) { setError(e instanceof Error ? e.message : "Sending stopped."); stopRef.current = true; break; }
          await new Promise(resolve => window.setTimeout(resolve, 1500 * attempt));
        }
      }
    }
    setBusy(false);
    setStage("done");
  };

  const downloadReport = () => {
    const rows = [["Worker ID", "Name", "Outcome", "Detail"], ...outcomes.map(o => [o.workerId, o.name, o.ok ? "Sent" : "Failed", o.error ?? ""]), ...(prepared?.skipped ?? []).map(s => [s.workerId, s.name, "Skipped", SKIP_LABELS[s.reason] ?? s.reason])];
    const csv = "﻿" + rows.map(row => row.map(safeWorkerCsvCell).join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `reelencer-email-${prepared?.id ?? "report"}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const skippedGroups = useMemo(() => {
    const groups = new Map<string, Skip[]>();
    for (const skip of prepared?.skipped ?? []) groups.set(skip.reason, [...(groups.get(skip.reason) ?? []), skip]);
    return [...groups];
  }, [prepared]);

  const progress = total ? Math.round((outcomes.length / total) * 100) : 0;

  const insertToken = (token: string) => {
    const field = messageRef.current;
    const text = `{${token}}`;
    const at = field ? field.selectionStart : content.message.length;
    const end = field ? field.selectionEnd : at;
    edit({ message: `${content.message.slice(0, at)}${text}${content.message.slice(end)}` });
    window.requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(at + text.length, at + text.length); });
  };

  const sendTest = async () => {
    if (!ready || test.state === "sending") return;
    setTest({ state: "sending" });
    try {
      const payload = await readJson(await apiFetch("/api/admin/broadcasts", { method: "POST", body: JSON.stringify({ action: "test", content }) }));
      setTest({ state: "sent", text: `Test sent to ${payload.to}` });
    } catch (e) {
      setTest({ state: "failed", text: e instanceof Error ? e.message : "The test couldn't be sent." });
    }
  };

  const preview = (
    <div className="flex h-[min(72vh,640px)] flex-col overflow-hidden rounded-2xl border border-[#e3e5e1] bg-white lg:h-full">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#e3e5e1] px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-[#1a201c]">{fillTokens(content.subject, "Priya Sharma", SAMPLE_VARS) || "Subject"}</p>
          <p className="truncate text-[11px] text-[#7a827c]">Reelencer · to priya@example.com</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Toggle label="Preview size" value={device} onChange={setDevice} options={[["desktop", "Desktop"], ["phone", "Phone"]]} />
          <Toggle label="Preview colours" value={theme} onChange={setTheme} options={[["light", "Light"], ["dark", "Dark"]]} />
        </div>
      </div>
      {previewHtml ? (
        <EmailPreviewFrame html={previewHtml} device={device} theme={theme} />
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-center text-[12.5px] text-[#7a827c]">{previewError ?? "Rendering the email…"}</div>
      )}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#0f1a13]/45 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget && stage !== "sending") onClose(); }}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className="flex h-[100dvh] w-full max-w-[1180px] flex-col overflow-hidden bg-white shadow-[0_24px_60px_-20px_rgba(15,26,19,0.45)] outline-none sm:h-[min(880px,94vh)] sm:rounded-3xl"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-[#ebedea] px-4 pb-3 pt-4 sm:px-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf5e6] text-[#2e7d4f]" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="text-[16px] font-semibold tracking-[-0.01em] text-[#1a201c]">Email users</h2>
            <p className="text-[12.5px] text-[#616a64]">Send a Terms reminder, a gig promotion or an announcement in one go.</p>
          </div>
          <button type="button" onClick={onClose} disabled={stage === "sending"} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#616a64] transition hover:bg-[#f1f3f0] disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {stage === "compose" ? (
          <div className="flex gap-1 border-b border-[#ebedea] px-4 sm:px-6" role="tablist">
            {(["compose", "history"] as const).map(value => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`-mb-px border-b-2 px-2 py-2.5 text-[13px] font-semibold transition ${tab === value ? "border-[#1f2b24] text-[#1a201c]" : "border-transparent text-[#7a827c] hover:text-[#1a201c]"}`}>
                {value === "compose" ? "Compose" : "Sent emails"}
              </button>
            ))}
          </div>
        ) : null}

        <div className={`min-h-0 flex-1 overflow-y-auto ${stage === "compose" && tab === "compose" ? "lg:overflow-hidden" : ""}`}>
          {tab === "history" && stage === "compose" ? (
            <div className="space-y-2 p-4 sm:p-6">
              {history === null ? <p className="text-[13px] text-[#7a827c]">Loading…</p>
                : history.length === 0 ? <p className="rounded-2xl border border-dashed border-[#d9ddd8] p-6 text-center text-[13px] text-[#7a827c]">No bulk emails yet.</p>
                : history.map(row => (
                  <div key={row.id} className="flex flex-col gap-1.5 rounded-2xl border border-[#e3e5e1] p-3.5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-[#1a201c]">{row.subject}</p>
                      <p className="text-[12px] text-[#7a827c]">{BROADCAST_KIND_LABELS[row.kind]} · {when(row.createdAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold">
                      <span className="rounded-full bg-[#e3f1df] px-2 py-0.5 text-[#1f5131]">{row.sent}/{row.recipients} sent</span>
                      {row.failed ? <span className="rounded-full bg-[#fde4e1] px-2 py-0.5 text-[#8e1f1a]">{row.failed} failed</span> : null}
                      {row.skipped ? <span className="rounded-full bg-[#f1f3f0] px-2 py-0.5 text-[#4b544e]">{row.skipped} skipped</span> : null}
                      {row.status === "ready" ? <span className="rounded-full bg-[#fdf0d2] px-2 py-0.5 text-[#6b4a05]">Not sent</span> : null}
                    </div>
                  </div>
                ))}
            </div>
          ) : stage === "compose" ? (
            <div className="grid gap-5 p-4 sm:p-6 lg:h-full lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-6 lg:p-0 lg:pl-6">
              <div className={`min-w-0 space-y-4 lg:-mr-2 lg:overflow-y-auto lg:py-6 lg:pr-2 ${mobilePane === "preview" ? "hidden lg:block" : ""}`}>
                {/* Audience */}
                <div>
                  <p className="mb-1.5 text-[12.5px] font-semibold text-[#3b443e]">Send to</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([["selected", "Selected users", selected.length], ["filtered", "Everyone in this view", filtered.length]] as const).map(([value, label, count]) => (
                      <button key={value} type="button" disabled={!count} aria-pressed={audience === value} onClick={() => setAudience(value)} className={`rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-40 ${audience === value ? "border-[#2e7d4f] bg-[#f3f8f4] ring-1 ring-[#2e7d4f]/30" : "border-[#e3e5e1] bg-white hover:border-[#cfd5cf]"}`}>
                        <span className="block text-[18px] font-bold tabular-nums text-[#1a201c]">{count}</span>
                        <span className="block text-[12px] font-medium text-[#616a64]">{label}</span>
                      </button>
                    ))}
                  </div>
                  {presets.length ? (
                    <div className="mt-2.5">
                      <p className="mb-1.5 text-[11.5px] font-medium text-[#7a827c]">Or a quick view</p>
                      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
                        {presets.map(preset => {
                          const active = audience === `preset:${preset.id}`;
                          return (
                            <button key={preset.id} type="button" disabled={!preset.workers.length} aria-pressed={active} onClick={() => choosePreset(preset)} className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border pl-3 pr-1.5 text-[12px] font-semibold transition disabled:opacity-40 ${active ? "border-[#1f2b24] bg-[#1f2b24] text-white" : "border-[#e3e5e1] bg-white text-[#3b443e] hover:border-[#cfd5cf]"}`}>
                              {preset.label}
                              <span className={`min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-[10.5px] tabular-nums ${active ? "bg-white/20" : "bg-[#f1f3f0] text-[#4b544e]"}`}>{preset.workers.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {overLimit ? <p className="mt-1.5 text-[11.5px] text-[#9a5b00]">One email can go to up to {BROADCAST_LIMITS.recipients} users; the first {BROADCAST_LIMITS.recipients} in this view are included.</p> : null}
                </div>

                {/* Kind */}
                <div>
                  <p className="mb-1.5 text-[12.5px] font-semibold text-[#3b443e]">Type</p>
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f1f3f0] p-1 sm:grid-cols-4">
                    {KINDS.map(kind => (
                      <button key={kind} type="button" aria-pressed={content.kind === kind} onClick={() => setKind(kind)} className={`rounded-lg px-2 py-2 text-[12.5px] font-semibold transition ${content.kind === kind ? "bg-white text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.1)]" : "text-[#616a64] hover:text-[#1a201c]"}`}>
                        {BROADCAST_KIND_LABELS[kind]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-[#7a827c]">{KIND_HINTS[content.kind]}</p>
                </div>

                {content.kind === "reminder" ? (
                  <Field label="Follow-up about" hint="Starts from a ready-made email for that situation. Edit anything before sending.">
                    <select className={inputCls} value={followUp} onChange={event => chooseFollowUp(event.target.value)}>
                      {ACTIVITY_PRESETS.filter(preset => hasFollowUp(preset.id)).map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                    </select>
                  </Field>
                ) : null}

                {content.kind === "promotion" ? (
                  <Field label="Gig to promote">
                    <select className={inputCls} value={content.gig?.id ?? ""} onChange={event => setGig(event.target.value)} disabled={!gigs}>
                      <option value="">{gigs === null ? "Loading open gigs…" : gigs.length ? "Choose an open gig" : "No open gigs"}</option>
                      {(gigs ?? []).map(gig => <option key={gig.id} value={gig.id}>{gig.title} · {gig.company}</option>)}
                    </select>
                  </Field>
                ) : null}

                <Field label="Subject" count={[content.subject.length, BROADCAST_LIMITS.subject]}>
                  <input className={inputCls} value={content.subject} onChange={event => edit({ subject: event.target.value })} />
                </Field>
                <Field label="Headline" count={[content.title.length, BROADCAST_LIMITS.title]}>
                  <input className={inputCls} value={content.title} onChange={event => edit({ title: event.target.value })} />
                </Field>
                <Field label="Message" count={[content.message.length, BROADCAST_LIMITS.message]} hint="Line breaks are kept and links become clickable.">
                  <textarea ref={messageRef} className={`${inputCls} h-48 resize-y py-2.5 leading-relaxed`} value={content.message} onChange={event => edit({ message: event.target.value })} />
                </Field>
                <div className="-mt-2">
                  <p className="mb-1.5 text-[11.5px] text-[#7a827c]">Personalise: tap to insert. Each person gets their own details; tokens also work in the subject, headline and button link.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {BROADCAST_TOKENS.map(({ token, label }) => (
                      <button key={token} type="button" onClick={() => insertToken(token)} title={`{${token}}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-[#9cc3a7] bg-[#f6faf5] px-2.5 text-[12px] font-semibold text-[#1f5131] transition hover:bg-[#eaf5e6]">
                        <span aria-hidden="true">+</span>{label}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="button" className={`${secondaryBtn} w-full sm:hidden`} disabled={!ready || test.state === "sending"} onClick={() => void sendTest()}>
                  {test.state === "sending" ? "Sending test…" : "Send a test to my inbox"}
                </button>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Button text">
                    <input className={inputCls} value={content.ctaLabel ?? ""} maxLength={BROADCAST_LIMITS.ctaLabel} onChange={event => edit({ ctaLabel: event.target.value })} placeholder="Leave empty for no button" />
                  </Field>
                  <Field label="Button link">
                    <input className={inputCls} value={content.ctaUrl ?? ""} onChange={event => edit({ ctaUrl: event.target.value })} placeholder="/dashboard or https://…" />
                  </Field>
                </div>
              </div>
              <div className={`min-w-0 lg:py-6 lg:pr-6 ${mobilePane === "edit" ? "hidden lg:block" : ""}`}>{preview}</div>
            </div>
          ) : stage === "review" && prepared ? (
            <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
              <div className="rounded-2xl border border-[#cfe0d3] bg-[#f6faf5] p-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#41695b]">{BROADCAST_KIND_LABELS[content.kind]}</p>
                <p className="mt-1 text-[15px] font-semibold text-[#1a201c]">{content.subject.replace(/\{first_name\}/gi, "…")}</p>
                <p className="mt-3 text-[28px] font-bold tabular-nums leading-none text-[#1f5131]">{prepared.recipients}</p>
                <p className="text-[12.5px] text-[#4b544e]">{prepared.recipients === 1 ? "person will get this email" : "people will get this email"}</p>
              </div>
              {skippedGroups.length ? (
                <div className="rounded-2xl border border-[#e3e5e1]">
                  <p className="border-b border-[#ebedea] px-4 py-2.5 text-[13px] font-semibold text-[#1a201c]">{prepared.skipped.length} won&apos;t get it</p>
                  {skippedGroups.map(([reason, rows]) => (
                    <details key={reason} className="group border-b border-[#ebedea] last:border-0">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[12.5px] text-[#3b443e] [&::-webkit-details-marker]:hidden">
                        <span>{SKIP_LABELS[reason] ?? reason}</span>
                        <span className="rounded-full bg-[#f1f3f0] px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-[#4b544e]">{rows.length}</span>
                      </summary>
                      <p className="px-4 pb-3 text-[12px] leading-5 text-[#7a827c]">{rows.slice(0, 30).map(row => row.name).join(", ")}{rows.length > 30 ? ` and ${rows.length - 30} more` : ""}</p>
                    </details>
                  ))}
                </div>
              ) : null}
              {isPromotional(content.kind) ? <p className="text-[12px] leading-5 text-[#7a827c]">Each email includes a one-click unsubscribe link, as the law requires for promotional email.</p> : null}
            </div>
          ) : (
            <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
              <div className="rounded-2xl border border-[#e3e5e1] p-5 text-center">
                {stage === "sending" ? (
                  <span className="mx-auto mb-3 block h-10 w-10 animate-spin rounded-full border-[3px] border-[#cfe0d3] border-t-[#2e7d4f] motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <span className={`mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full ${failed || stopped ? "bg-[#fdf0d2] text-[#9a5b00]" : "bg-[#2e7d4f] text-white"}`} aria-hidden="true">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{failed || stopped ? <path d="M12 8v5M12 16.5v.5" /> : <path d="m5 12 4 4L19 6" />}</svg>
                  </span>
                )}
                <p className="text-[16px] font-semibold text-[#1a201c]" role="status" aria-live="polite">
                  {stage === "sending" ? `Sending… ${outcomes.length} of ${total}` : stopped ? `Stopped after ${outcomes.length} of ${total}` : failed ? `Sent to ${sent} of ${total}` : `Sent to all ${sent}`}
                </p>
                <div className="mx-auto mt-3 h-2 max-w-sm overflow-hidden rounded-full bg-[#eef0ed]">
                  <div className="h-full rounded-full bg-[#2e7d4f] transition-[width] duration-500" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-2 text-[12px] text-[#7a827c]">{sent} sent{failed ? ` · ${failed} failed` : ""}{prepared?.skipped.length ? ` · ${prepared.skipped.length} skipped` : ""}</p>
              </div>
              {failed ? (
                <div className="rounded-2xl border border-[#f1c9c4] bg-[#fdf6f5] p-4">
                  <p className="text-[13px] font-semibold text-[#8e1f1a]">Didn&apos;t go through</p>
                  <ul className="mt-1.5 space-y-1 text-[12px] text-[#5c1a16]">
                    {outcomes.filter(o => !o.ok).slice(0, 8).map(o => <li key={o.workerId} className="break-words"><strong>{o.name}</strong>: {o.error}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 border-t border-[#ebedea] bg-[#fafbf9] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {error ? <p role="alert" className="text-[12.5px] font-medium text-[#b42318]">{error}</p>
            : stage === "compose" && tab === "compose" && test.state !== "idle" ? <p role="status" className={`min-w-0 truncate text-[12px] font-medium ${test.state === "failed" ? "text-[#b42318]" : "text-[#2e7d4f]"}`}>{test.state === "sending" ? "Sending a test to your inbox…" : test.text}</p>
            : <p className="text-[12px] text-[#7a827c]">{stage === "compose" && tab === "compose" ? `${recipientIds.length} ${recipientIds.length === 1 ? "user" : "users"} · ${audienceLabel} · ${BROADCAST_KIND_LABELS[content.kind]}` : ""}</p>}
          <div className="flex gap-2">
            {stage === "compose" && tab === "compose" ? (
              <>
                <button type="button" className={`${secondaryBtn} flex-1 lg:hidden`} onClick={() => setMobilePane(pane => pane === "edit" ? "preview" : "edit")}>{mobilePane === "edit" ? "Preview" : "Edit"}</button>
                <button type="button" className={`${secondaryBtn} hidden sm:inline-flex`} disabled={!ready || test.state === "sending"} onClick={() => void sendTest()}>{test.state === "sending" ? "Sending test…" : "Send test to me"}</button>
                <button type="button" className={`${primaryBtn} flex-1 sm:flex-none`} disabled={!ready || busy} onClick={() => void review()}>{busy ? "Checking recipients…" : "Review & send"}</button>
              </>
            ) : stage === "review" ? (
              <>
                <button type="button" className={`${secondaryBtn} flex-1 sm:flex-none`} onClick={() => setStage("compose")}>Back</button>
                <button type="button" className={`${primaryBtn} flex-1 sm:flex-none`} disabled={!prepared?.recipients || busy} onClick={() => void send()}>Send to {prepared?.recipients ?? 0}</button>
              </>
            ) : stage === "sending" ? (
              <button type="button" className={`${secondaryBtn} flex-1 sm:flex-none`} onClick={() => { stopRef.current = true; setStopRequested(true); }} disabled={stopRequested}>{stopRequested ? "Stopping after this batch…" : "Stop sending"}</button>
            ) : (
              <>
                <button type="button" className={`${secondaryBtn} flex-1 sm:flex-none`} onClick={downloadReport}>Download report</button>
                <button type="button" className={`${primaryBtn} flex-1 sm:flex-none`} onClick={onClose}>Done</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
