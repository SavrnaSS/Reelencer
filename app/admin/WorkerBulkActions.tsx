"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api/client";
import { supabase } from "@/lib/supabaseClient";
import { safeWorkerCsvCell } from "@/lib/adminWorkerDirectory";
import type { BulkAction, BulkApplyRequest, BulkPreview, BulkResult } from "@/lib/workerBulkTypes";
import styles from "./WorkerBulkActions.module.css";

export type { BulkResult } from "@/lib/workerBulkTypes";

type Worker = { id: string; userId?: string; name: string; email: string; active: boolean; moderationStatus?: "active" | "suspended" | "deleted" };
type Review = { action: BulkAction; workerIds: string[] };
type PendingOperation = { payload: BulkApplyRequest; action: BulkAction; submittedAt: string; expiresAt: string; total: number };
type Stage = "idle" | "submitting" | "checking" | "uncertain";
type ResultRecord = { result: BulkResult; completedAt: string };

const LABELS: Record<BulkAction, string> = { suspend: "Suspend selected", suspend_ip: "Suspend + IP", restore: "Restore selected", delete: "Delete selected" };
const TITLES: Record<BulkAction, string> = { suspend: "Suspend selected users", suspend_ip: "Suspend users + block IPs", restore: "Restore selected users", delete: "Delete selected users" };
const VERBS: Record<BulkAction, string> = { suspend: "Suspend", suspend_ip: "Suspend + block IPs for", restore: "Restore", delete: "Delete" };
const ACTIONS: BulkAction[] = ["suspend", "suspend_ip", "restore", "delete"];
const INVALID_REASON_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function Icon({ kind = "users" }: { kind?: "users" | "suspend" | "suspend_ip" | "restore" | "delete" | "close" | "check" }) {
  const paths: Record<string, ReactNode> = {
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" /></>,
    suspend: <><circle cx="12" cy="12" r="9" /><path d="M9 8v8M15 8v8" /></>,
    suspend_ip: <><circle cx="12" cy="5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="M12 7v5M5 16v-4h14v4" /></>,
    restore: <><path d="M3 4v6h6" /><path d="M4 10a8 8 0 1 1 0 5" /></>,
    delete: <><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>;
}

function messageFor(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const object = payload as { error?: unknown; message?: unknown };
  if (typeof object.error === "string") return object.error;
  if (object.error && typeof object.error === "object" && "message" in object.error && typeof object.error.message === "string") return object.error.message;
  return typeof object.message === "string" ? object.message : fallback;
}

function isPreview(value: unknown): value is BulkPreview {
  if (!value || typeof value !== "object") return false;
  const preview = value as Partial<BulkPreview>;
  return typeof preview.token === "string" && typeof preview.expiresAt === "string" && Array.isArray(preview.items) && typeof preview.eligibleCount === "number" && typeof preview.skippedCount === "number" && ACTIONS.includes(preview.action as BulkAction);
}

function isResult(value: unknown, operationId: string): value is BulkResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<BulkResult>;
  return result.operationId === operationId && Array.isArray(result.items) && typeof result.succeeded === "number" && typeof result.skipped === "number" && typeof result.failed === "number" && ACTIONS.includes(result.action as BulkAction);
}

function storedOperation(value: unknown): value is PendingOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Partial<PendingOperation>;
  return !!operation.payload && typeof operation.payload.operationId === "string" && /^[\da-f-]{36}$/i.test(operation.payload.operationId) && typeof operation.payload.previewToken === "string" && typeof operation.payload.reason === "string" && ACTIONS.includes(operation.action as BulkAction) && typeof operation.submittedAt === "string" && typeof operation.expiresAt === "string" && typeof operation.total === "number";
}

function formatDate(value: string): string {
  return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Time unavailable";
}

function downloadResultCsv(record: ResultRecord) {
  const rows: unknown[][] = [["Operation ID", "Action", "Worker ID", "Name", "Outcome", "Message", "Result received at"]];
  for (const item of record.result.items) rows.push([record.result.operationId, record.result.action, item.workerId, item.name, item.status, item.message, record.completedAt]);
  const csv = "\uFEFF" + rows.map((row) => row.map(safeWorkerCsvCell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `worker-bulk-results-${record.result.operationId}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function request(path: string, init: RequestInit, controller: AbortController, timeoutMs = 35_000) {
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await apiFetch(path, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  } catch (error) {
    if (timedOut) throw new Error("The request timed out. Its final outcome has not been confirmed.");
    throw error;
  } finally { window.clearTimeout(timer); }
}

export default function WorkerBulkActions({ workers, onCompleted, onClear }: { workers: Worker[]; onCompleted: (result: BulkResult) => void | Promise<void>; onClear: () => void }) {
  const headingId = useId();
  const [review, setReview] = useState<Review | null>(null);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [operation, setOperation] = useState<PendingOperation | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ResultRecord | null>(null);
  const [resultFilter, setResultFilter] = useState<"all" | "attention">("all");
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [safetyNotice, setSafetyNotice] = useState<string | null>(null);
  const [identityReady, setIdentityReady] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityRevision, setIdentityRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(false);
  const working = useRef(false);
  const previewRequest = useRef<AbortController | null>(null);
  const operationRequest = useRef<AbortController | null>(null);
  const previewSequence = useRef(0);
  const storageKey = useRef<string | null>(null);
  const delivered = useRef(new Set<string>());
  const callback = useRef(onCompleted);
  const recovery = useRef<(operation: PendingOperation) => Promise<void>>(async () => undefined);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const lastResultId = lastResult?.result.operationId;
  callback.current = onCompleted;

  const clearStored = useCallback(() => {
    try { if (storageKey.current) window.sessionStorage.removeItem(storageKey.current); } catch { /* State in this tab remains available. */ }
  }, []);

  const finish = useCallback((target: PendingOperation, result: BulkResult) => {
    if (!mounted.current) return;
    clearStored();
    setOperation(null);
    setOperationError(null);
    setStage("idle");
    setOpen(false);
    setReview(null);
    setPreview(null);
    setLastResult({ result, completedAt: new Date().toISOString() });
    setResultFilter("all");
    setCompletionNotice(null);
    if (!delivered.current.has(target.payload.operationId)) {
      delivered.current.add(target.payload.operationId);
      try {
        void Promise.resolve(callback.current(result)).catch(() => { if (mounted.current) setCompletionNotice("The action finished. Refresh the worker directory to load its latest state."); });
      } catch { setCompletionNotice("The action finished. Refresh the worker directory to load its latest state."); }
    }
  }, [clearStored]);

  const lookup = useCallback(async (target: PendingOperation): Promise<BulkResult | null> => {
    const controller = new AbortController();
    operationRequest.current = controller;
    const { response, payload } = await request(`/api/admin/workers/bulk?operationId=${encodeURIComponent(target.payload.operationId)}`, {}, controller, 20_000);
    if (response.status === 404) return null;
    if (!response.ok || !payload?.ok || !isResult(payload.result, target.payload.operationId)) throw new Error(messageFor(payload, "The saved result could not be checked. Please check again when your connection is available."));
    return payload.result;
  }, []);

  const checkResult = useCallback(async (target: PendingOperation) => {
    if (working.current) return;
    working.current = true;
    setStage("checking");
    setOperationError(null);
    try {
      const result = await lookup(target);
      if (result) finish(target, result);
      else if (mounted.current) { setStage("uncertain"); setOperationError("No completed result is available yet. The original request may still be processing. Check again, or retry the same reviewed request."); }
    } catch (error) {
      if (mounted.current) { setStage("uncertain"); setOperationError(error instanceof Error ? error.message : "The result could not be confirmed. Check again before starting another action."); }
    } finally { working.current = false; }
  }, [finish, lookup]);
  recovery.current = checkResult;

  useEffect(() => {
    mounted.current = true;
    let active = true;
    setIdentityReady(false);
    setIdentityError(null);
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session?.user.id) throw new Error("Your administrator session could not be verified. Sign in again or retry the session check.");
      storageKey.current = `reelencer:admin:bulk-pending:${data.session.user.id}`;
      try {
        const raw = window.sessionStorage.getItem(storageKey.current);
        if (raw) {
          const saved: unknown = JSON.parse(raw);
          if (storedOperation(saved)) { setOperation(saved); void recovery.current(saved); }
          else window.sessionStorage.removeItem(storageKey.current);
        }
      } catch { /* Recovery in the current tab still works if storage is unavailable. */ }
      setIdentityReady(true);
    }).catch((error) => { if (active) setIdentityError(error instanceof Error ? error.message : "The administrator session could not be checked. Retry before starting a bulk action."); });
    return () => { active = false; mounted.current = false; previewRequest.current?.abort(); operationRequest.current?.abort(); };
  }, [identityRevision]);

  useEffect(() => {
    if (!open || !preview) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [open, preview]);

  useEffect(() => { if (open && preview && !operation && !previewLoading) reasonInput.current?.focus(); }, [open, preview, operation, previewLoading]);

  useEffect(() => {
    if (!lastResultId) return;
    const frame = window.requestAnimationFrame(() => {
      root.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lastResultId]);

  const loadPreview = async (target: Review) => {
    previewRequest.current?.abort();
    const sequence = ++previewSequence.current;
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    setConfirmation("");
    setAcknowledged(false);
    try {
      const { response, payload } = await request("/api/admin/workers/bulk/preview", { method: "POST", body: JSON.stringify({ workerIds: target.workerIds, action: target.action }) }, controller, 25_000);
      if (!response.ok || !payload?.ok || !isPreview(payload.preview) || payload.preview.action !== target.action) throw new Error(messageFor(payload, "The selected users could not be reviewed. Please try again."));
      if (mounted.current && sequence === previewSequence.current) setPreview(payload.preview);
    } catch (error) {
      if (mounted.current && sequence === previewSequence.current && !controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : "The preview could not be loaded.");
      else if (mounted.current && sequence === previewSequence.current && error instanceof Error && error.message.includes("timed out")) setPreviewError(error.message);
    } finally { if (mounted.current && sequence === previewSequence.current) setPreviewLoading(false); }
  };

  const begin = (action: BulkAction) => {
    if (!identityReady || !workers.length || workers.length > 100 || operation || working.current) return;
    const target = { action, workerIds: Array.from(new Set(workers.map((worker) => worker.id))) };
    setReview(target);
    setReason("");
    setOperationError(null);
    setSafetyNotice(null);
    setOpen(true);
    void loadPreview(target);
  };

  const send = async (target: PendingOperation, retry: boolean) => {
    if (working.current) return;
    working.current = true;
    setOperationError(null);
    try {
      if (retry) {
        setStage("checking");
        const saved = await lookup(target);
        if (saved) { finish(target, saved); return; }
      }
      if (!mounted.current) return;
      setStage("submitting");
      const controller = new AbortController();
      operationRequest.current = controller;
      const { response, payload } = await request("/api/admin/workers/bulk", { method: "POST", body: JSON.stringify(target.payload) }, controller, 45_000);
      if (response.status === 409 && payload?.code === "bulk_preview_expired") {
        // The server serializes this expiry check after any prior request and saved-result lookup.
        // This response definitively confirms that the expired review did not commit changes.
        if (mounted.current) {
          clearStored();
          setOperation(null);
          setStage("idle");
          setOperationError(null);
          setOpen(false);
          setReview(null);
          setPreview(null);
          setSafetyNotice("The previous review expired before any changes were applied. Select users and create a fresh review.");
        }
        return;
      }
      if (!response.ok || !payload?.ok || !isResult(payload.result, target.payload.operationId)) throw new Error(messageFor(payload, "The final outcome could not be confirmed."));
      finish(target, payload.result);
    } catch (error) {
      if (!mounted.current) return;
      setStage("checking");
      try {
        const saved = await lookup(target);
        if (saved) { finish(target, saved); return; }
      } catch { /* Keep the original reviewed request available for recovery. */ }
      if (mounted.current) {
        setStage("uncertain");
        setOperationError(`${error instanceof Error ? error.message : "The connection ended before confirmation."} No completed result has been confirmed. Check the result before starting another bulk action.`);
      }
    } finally { working.current = false; }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!preview || operation || working.current || preview.eligibleCount < 1 || !Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= Date.now() || reason.trim().length < 8 || reason.trim().length > 1000 || INVALID_REASON_CONTROLS.test(reason.trim()) || (preview.action === "delete" && confirmation.trim() !== `DELETE ${preview.eligibleCount} USERS`) || (preview.action === "suspend_ip" && (!acknowledged || !preview.canBlockIps))) return;
    const target: PendingOperation = {
      payload: { previewToken: preview.token, operationId: crypto.randomUUID(), reason: reason.trim(), ...(preview.action === "delete" ? { confirmation: confirmation.trim() } : {}), ...(preview.action === "suspend_ip" ? { sharedNetworkConfirmed: true } : {}) },
      action: preview.action,
      total: preview.eligibleCount,
      submittedAt: new Date().toISOString(),
      expiresAt: preview.expiresAt,
    };
    setOperation(target);
    try { if (storageKey.current) window.sessionStorage.setItem(storageKey.current, JSON.stringify(target)); } catch { /* The unchanged request remains in memory for recovery. */ }
    void send(target, false);
  };

  const busy = stage === "submitting" || stage === "checking";
  const close = () => {
    if (busy || working.current) return;
    setOpen(false);
    if (!operation) { previewSequence.current += 1; previewRequest.current?.abort(); setReview(null); setPreview(null); setPreviewLoading(false); }
  };
  const expired = !!preview && (!Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= now);
  const invalidReasonControls = INVALID_REASON_CONTROLS.test(reason.trim());
  const validReason = reason.trim().length >= 8 && reason.trim().length <= 1000 && !invalidReasonControls;
  const ready = !!preview && preview.eligibleCount > 0 && !expired && validReason && (preview.action !== "delete" || confirmation.trim() === `DELETE ${preview.eligibleCount} USERS`) && (preview.action !== "suspend_ip" || (acknowledged && preview.canBlockIps));
  const action = operation?.action ?? review?.action ?? "suspend";
  const result = lastResult?.result;
  const visibleResults = result?.items.filter((item) => resultFilter === "all" || item.status !== "success") ?? [];

  if (!workers.length && !operation && !result && !safetyNotice) return null;

  return <div ref={root} className={`${styles.root} ${workers.length > 0 && !result && !operation ? styles.docked : ""}`} tabIndex={-1}>
    {safetyNotice && <p className={styles.warning} role="status">{safetyNotice}</p>}
    {workers.length > 0 && <section className={styles.toolbar} aria-labelledby={headingId}>
      <div className={styles.toolbarHeading}><span className={styles.selectionIcon}><Icon /></span><div><h3 id={headingId}>{workers.length} {workers.length === 1 ? "user" : "users"} selected</h3><p>Review the exact changes before applying.</p></div><button type="button" className={styles.clearButton} onClick={onClear} disabled={busy}>Clear selection</button></div>
      {workers.length > 100 && <p className={styles.error} role="alert">Select at most 100 users for one bulk action.</p>}
      <div className={styles.actionGrid}>{ACTIONS.map((item) => <button key={item} type="button" className={`${styles.actionButton} ${item === "delete" ? styles.deleteAction : ""}`} disabled={!identityReady || !!operation || busy || workers.length > 100} onClick={() => begin(item)}><Icon kind={item} />{LABELS[item]}</button>)}</div>
      {!identityReady && !identityError && <p className={styles.hint} role="status">Checking for unfinished operations…</p>}
      {identityError && <div className={styles.error} role="alert"><p>{identityError}</p><button type="button" className={styles.secondaryButton} onClick={() => setIdentityRevision((value) => value + 1)}>Retry session check</button></div>}
      {operation && <p className={styles.hint}>Confirm the pending operation’s result before starting another bulk action.</p>}
    </section>}

    {operation && <section className={styles.recovery} aria-live="polite" aria-atomic="true">
      <div className={styles.recoveryHeading}>{busy ? <span className={styles.spinner} /> : <Icon kind="suspend" />}<strong>{busy ? stage === "checking" ? "Checking the saved result…" : "Applying the reviewed action…" : "Result needs confirmation"}</strong></div>
      <p>{operationError ?? `Processing the reviewed ${operation.total}-user request. The result will list the outcome for each user.`}</p>
      <p className={styles.hint}>Request {operation.payload.operationId} · Submitted {formatDate(operation.submittedAt)}</p>
      {!busy && <div className={styles.recoveryButtons}><button type="button" className={styles.secondaryButton} onClick={() => void checkResult(operation)}>Check result</button><button type="button" className={styles.secondaryButton} onClick={() => setOpen(true)}>Open recovery review</button></div>}
    </section>}

    {lastResult && result && <section className={styles.results} aria-label="Bulk action results">
      <div className={styles.resultHeading}><div><p className={styles.eyebrow}>Bulk action complete</p><h3>{TITLES[result.action]}</h3><p className={styles.hint}>{formatDate(lastResult.completedAt)} · Request {result.operationId}</p></div><button type="button" className={styles.iconButton} aria-label="Dismiss bulk action results" onClick={() => setLastResult(null)}><Icon kind="close" /></button></div>
      <div className={styles.resultCounts} role="status"><span className={styles.successBadge}>{result.succeeded} succeeded</span><span className={styles.skippedBadge}>{result.skipped} skipped</span><span className={result.failed ? styles.failedBadge : styles.neutralBadge}>{result.failed} failed</span></div>
      {(result.failed > 0 || result.skipped > 0) && <p className={styles.hint}>Failed and skipped users remain selected. Review their outcomes, then start a new review for the users you want to retry.</p>}
      {completionNotice && <p className={styles.error} role="alert">{completionNotice}</p>}
      <button type="button" className={styles.exportButton} onClick={() => downloadResultCsv(lastResult)}>Download results CSV</button>
      <details className={styles.resultDetails} open={result.failed > 0 || result.skipped > 0}><summary>Per-user outcomes ({result.items.length})</summary><div className={styles.resultFilters}><button type="button" aria-pressed={resultFilter === "all"} onClick={() => setResultFilter("all")}>All results</button><button type="button" aria-pressed={resultFilter === "attention"} onClick={() => setResultFilter("attention")}>Needs attention ({result.failed + result.skipped})</button></div><ul className={styles.resultList}>{visibleResults.map((item) => <li key={`${result.operationId}:${item.workerId}`}><div className={styles.targetIdentity}><strong>{item.name || item.workerId}</strong><span>{item.workerId}</span><p>{item.message}</p></div><span className={item.status === "success" ? styles.successBadge : item.status === "failed" ? styles.failedBadge : styles.skippedBadge}>{item.status === "success" ? "Succeeded" : item.status === "failed" ? "Failed" : "Skipped"}</span></li>)}</ul>{visibleResults.length === 0 && <p className={styles.hint}>No results need attention.</p>}</details>
    </section>}

    {open && <BulkDialog title={operation ? "Confirm the bulk action’s result" : TITLES[action]} busy={busy} onClose={close} fallbackFocus={root}>
      {operation ? <div className={styles.operationView}>
        <div className={styles.operationStatus} role="status" tabIndex={0} data-bulk-progress>{busy ? <span className={styles.spinner} /> : <Icon kind="suspend" />}<strong>{stage === "submitting" ? "Applying the reviewed action…" : stage === "checking" ? "Checking the saved result…" : "The outcome is not confirmed yet"}</strong></div>
        <p>{operationError ?? `Your reviewed request for ${operation.total} users is being processed. Keep this review open until its result is confirmed.`}</p>
        <div className={styles.operationReference}><span>{TITLES[operation.action]} · {operation.total} users</span><code>{operation.payload.operationId}</code><span>Submitted {formatDate(operation.submittedAt)}</span></div>
        <p className={styles.hint}>A connection error does not cancel a submitted request. Checking the result is read-only. Retrying sends the exact same reviewed request and request ID, which prevents applying it twice.</p>
        {!busy && <><div className={styles.recoveryButtons}><button type="button" className={styles.confirmButton} onClick={() => void checkResult(operation)}>Check result</button><button type="button" className={styles.secondaryButton} onClick={() => void send(operation, true)}>Retry same request</button></div><p className={styles.hint}>You can close this review and check the result from the recovery notice. Keep this browser tab open until it is confirmed.</p><div className={styles.dialogFooter}><button type="button" className={styles.secondaryButton} onClick={close}>Close review</button></div></>}
      </div> : <form onSubmit={submit}>
        <p className={styles.dialogIntro}>{action === "delete" ? "Disable access now and schedule permanent removal of these users, their files and app records after 7 days. Restoring access before cleanup starts cancels removal. Permanent deletion cannot be undone." : action === "suspend_ip" ? "Suspend eligible users and block the most recent safe, recorded public IP shown for each user. Review every address: a shared IP block can affect other users." : action === "restore" ? "Restore access for eligible users, cancel scheduled permanent deletion and remove IP blocks recorded for them. Blocks recorded for other users remain." : "Suspend application access for eligible users. Work, audit and payment records are retained."}</p>
        {previewLoading && <div className={styles.previewLoading} role="status"><span className={styles.spinner} /><span>Checking the selected users and preparing a review…</span></div>}
        {previewError && <div className={styles.error} role="alert"><p>{previewError}</p><button type="button" className={styles.secondaryButton} onClick={() => { if (review) void loadPreview(review); }}>Retry preview</button></div>}
        {preview && <>
          <div className={styles.previewCounts}><span><strong>{preview.eligibleCount}</strong> eligible</span><span><strong>{preview.skippedCount}</strong> will be skipped</span></div>
          <p className={styles.hint}>Only eligible users will be changed. Users whose access changes after this review are skipped safely.</p>
          <div className={styles.targetList} role="region" aria-label="Exact users included in this review" tabIndex={0}><ul>{preview.items.map((item) => <li key={item.userId || item.workerId}><div className={styles.targetIdentity}><strong>{item.name || item.workerId}</strong><span>{item.workerId}{item.email ? ` · ${item.email}` : ""}</span>{item.ip && <code className={styles.ipAddress}>IP to block: {item.ip}</code>}{item.skipReason && <p>{item.skipReason}</p>}</div><span className={item.eligible ? styles.successBadge : styles.skippedBadge}>{item.eligible ? "Eligible" : "Skipped"}</span></li>)}</ul></div>
          {!preview.eligibleCount && <p className={styles.warning}>No users are eligible for this action. Review the skipped reasons above or choose another action.</p>}
          {action === "suspend_ip" && !preview.canBlockIps && <p className={styles.warning}>IP blocking is unavailable because your current connection cannot be verified. You can review a suspension without IP blocking instead.</p>}
          <div className={styles.expiry}><span>{expired ? "This review has expired. Refresh it before applying." : `Review expires ${formatDate(preview.expiresAt)}`}</span><button type="button" onClick={() => { if (review) void loadPreview(review); }}>Refresh preview</button></div>
          {preview.eligibleCount > 0 && <>
            {action === "suspend_ip" && <label className={styles.acknowledgement}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} required /><span>I reviewed the exact IP addresses and understand that blocking shared household, office or mobile connections can affect other users.</span></label>}
            <label className={styles.fieldLabel} htmlFor={`${headingId}-reason`}>Reason for this action <span>Required</span></label><textarea ref={reasonInput} id={`${headingId}-reason`} className={styles.textarea} value={reason} onChange={(event) => setReason(event.target.value)} required minLength={8} maxLength={1000} rows={3} placeholder="Explain what was reviewed and why this action is necessary…" aria-invalid={invalidReasonControls || undefined} aria-describedby={`${headingId}-reason-hint`} /><p id={`${headingId}-reason-hint`} className={`${styles.fieldHint} ${invalidReasonControls ? styles.invalidHint : ""}`}><span>{invalidReasonControls ? "Remove unsupported control characters from the reason." : "8–1,000 characters · Recorded for every changed user"}</span><span>{reason.length}/1,000</span></p>
            {action === "delete" && <div className={styles.confirmationField}><label className={styles.fieldLabel} htmlFor={`${headingId}-confirmation`}>Type <code>DELETE {preview.eligibleCount} USERS</code> to confirm</label><input id={`${headingId}-confirmation`} className={styles.confirmationInput} autoComplete="off" autoCapitalize="off" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required placeholder={`DELETE ${preview.eligibleCount} USERS`} /></div>}
          </>}
        </>}
        <div className={styles.dialogFooter}><button type="button" className={styles.secondaryButton} onClick={close}>Cancel review</button><button type="submit" className={`${styles.confirmButton} ${action === "delete" || action === "suspend_ip" ? styles.destructive : ""}`} disabled={!ready || previewLoading}>{preview ? `${VERBS[action]} ${preview.eligibleCount} ${preview.eligibleCount === 1 ? "user" : "users"}` : "Apply reviewed action"}</button></div>
      </form>}
    </BulkDialog>}
  </div>;
}

function BulkDialog({ title, busy, onClose, children, fallbackFocus }: { title: string; busy: boolean; onClose: () => void; children: ReactNode; fallbackFocus: { current: HTMLElement | null } }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const fallbackElement = fallbackFocus.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected && !previousFocus.matches(":disabled")) previousFocus.focus({ preventScroll: true }); else if (fallbackElement?.isConnected) fallbackElement.focus({ preventScroll: true }); };
  }, [fallbackFocus]);
  useEffect(() => { if (busy) dialog.current?.querySelector<HTMLElement>("[data-bulk-progress]")?.focus(); }, [busy]);
  const trap = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const targets = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex="0"]');
    if (!targets?.length) { event.preventDefault(); return; }
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-busy={busy} onKeyDown={trap} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}><div className={styles.dialogBody}><div className={styles.dialogHeader}><div><p className={styles.eyebrow}>Review bulk action</p><h3 id={titleId}>{title}</h3></div><button type="button" className={styles.iconButton} aria-label="Close bulk review" onClick={onClose} disabled={busy}><Icon kind="close" /></button></div>{children}</div></dialog>, document.body);
}
