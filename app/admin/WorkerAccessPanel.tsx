"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api/client";
import { useAdminLive } from "@/lib/useAdminLive";
import styles from "./WorkerAccessPanel.module.css";

type WorkerAccess = {
  id: string;
  userId?: string;
  name: string;
  email: string;
  active: boolean;
};

type Moderation = {
  status: "active" | "suspended" | "deleted";
  reason: string | null;
  suspendedAt: string | null;
  deletedAt: string | null;
  purgeAfter?: string | null;
  purgeStartedAt?: string | null;
  cleanupStatus?: "scheduled" | "processing" | "retry" | null;
  cleanupRetryAt?: string | null;
  lastSeenAt: string | null;
  ipTrackingEnabled?: boolean;
  canBlockIps?: boolean;
  knownIps: Array<{ ip: string; lastSeenAt: string; blocked: boolean; eligible?: boolean }>;
  history: Array<{ id: string; action: string; reason: string; createdAt: string; actorLabel?: string }>;
};

type Action = "suspend" | "suspend_ip" | "restore" | "delete" | "unblock_ip";
type Selection = { action: Action; ip?: string };
type Notice = { kind: "success" | "error"; text: string };

const ACTION_LABELS: Record<Action, string> = {
  suspend: "Suspend access",
  suspend_ip: "Suspend + block IP",
  restore: "Restore access",
  delete: "Delete user",
  unblock_ip: "Unblock IP",
};

const SUCCESS_LABELS: Record<Action, string> = {
  suspend: "User access suspended.",
  suspend_ip: "User access suspended and the selected IP address blocked.",
  restore: "User access restored and this user’s IP blocks removed. Blocks recorded for other users may still apply.",
  delete: "User deleted and access disabled. Permanent removal is scheduled after 7 days; restore access before cleanup begins to cancel it.",
  unblock_ip: "This user’s IP block was removed. Their access status is unchanged; blocks recorded for other users may still apply.",
};

function ShieldIcon({ variant = "shield" }: { variant?: "shield" | "pause" | "network" | "restore" | "archive" | "close" }) {
  const paths: Record<string, ReactNode> = {
    shield: <><path d="M12 3 4 6v5c0 5 8 10 8 10s8-5 8-10V6l-8-3Z" /><path d="m8.5 11.5 2.5 2.5 4.5-5" /></>,
    pause: <><path d="M9 8v8M15 8v8" /><circle cx="12" cy="12" r="9" /></>,
    network: <><circle cx="12" cy="5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="M12 7v5M5 16v-4h14v4" /></>,
    restore: <><path d="M3 4v6h6" /><path d="M4 10a8 8 0 1 1 0 5" /></>,
    archive: <><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[variant]}</svg>;
}

function validModeration(value: unknown): value is Moderation {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Moderation>;
  return ["active", "suspended", "deleted"].includes(String(record.status)) && Array.isArray(record.knownIps) && Array.isArray(record.history);
}

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const value = payload as { error?: unknown; message?: unknown };
    if (typeof value.error === "string") return value.error;
    if (value.error && typeof value.error === "object" && "message" in value.error && typeof value.error.message === "string") return value.error.message;
    if (typeof value.message === "string") return value.message;
  }
  return fallback;
}

function dateLabel(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function historyLabel(action: string): string {
  const labels: Record<string, string> = {
    suspend: "Access suspended",
    suspend_ip: "Access suspended + IP blocked",
    restore: "Access restored",
    delete: "User archived",
    unblock_ip: "IP block removed",
    suspended: "Access suspended",
    suspended_ip: "Access suspended + IPs blocked",
    restored: "Access restored",
    deleted: "User archived",
    ip_unblocked: "IP unblocked",
  };
  return labels[action] || action.replace(/_/g, " ");
}

export default function WorkerAccessPanel({ worker, onChanged }: { worker: WorkerAccess; onChanged: () => void | Promise<void> }) {
  const headingId = useId();
  const [record, setRecord] = useState<{ workerId: string; data: Moderation } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const currentWorker = useRef(worker.id);
  const mounted = useRef(false);
  const pendingRef = useRef(false);
  const callbackRef = useRef(onChanged);
  const mutationController = useRef<AbortController | null>(null);
  const refreshDeferred = useRef(false);
  currentWorker.current = worker.id;
  callbackRef.current = onChanged;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      mutationController.current?.abort();
    };
  }, []);

  useEffect(() => {
    setSelection(null);
    setNotice(null);
    setPending(false);
    pendingRef.current = false;
  }, [worker.id]);

  useAdminLive(true, (kinds) => {
    if (kinds && !Array.from(kinds).some((kind) => ["all", "worker", "workers", "worker_kyc", "work_items", "worker_moderation", "worker_ip_blocks", "worker_deletion_jobs"].includes(kind))) return;
    if (pending || selection) { refreshDeferred.current = true; return; }
    setRevision((value) => value + 1);
  }, { pollMs: 30_000, refreshOnConnect: false });

  useEffect(() => {
    if (!pending && !selection && refreshDeferred.current) {
      refreshDeferred.current = false;
      setRevision((value) => value + 1);
    }
  }, [pending, selection]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    setLoading(true);
    setLoadError(null);
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    void (async () => {
      try {
        const response = await apiFetch(`/api/admin/workers/${encodeURIComponent(worker.id)}/moderation`, { signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !validModeration(payload.moderation)) {
          throw new Error(responseError(payload, "Access details could not be loaded. Please try again."));
        }
        if (active) setRecord({ workerId: worker.id, data: payload.moderation });
      } catch (error) {
        if (active && (!controller.signal.aborted || timedOut)) setLoadError(timedOut ? "Loading access details timed out. Please try again." : error instanceof Error ? error.message : "Access details could not be loaded.");
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [worker.id, revision]);

  const moderation = record?.workerId === worker.id ? record.data : null;
  const status = moderation?.status;
  const knownIps = moderation?.knownIps ?? [];
  const eligibleIps = knownIps.filter((item) => item.eligible !== false);
  const blockedCount = knownIps.filter((item) => item.blocked).length;
  const canAct = !!moderation && !loading && !loadError && !pending;
  const closeDialog = useCallback(() => setSelection(null), []);

  const mutate = async (target: Selection, reason: string, confirmation: string) => {
    if (pendingRef.current) return;
    const targetId = worker.id;
    pendingRef.current = true;
    setPending(true);
    setNotice(null);
    const controller = new AbortController();
    mutationController.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
    try {
      const response = await apiFetch(`/api/admin/workers/${encodeURIComponent(targetId)}/moderation`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ action: target.action, reason: reason.trim(), ...(target.ip ? { ip: target.ip } : {}), ...(target.action === "delete" ? { confirmation: confirmation.trim() } : {}) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(responseError(payload, "The action could not be completed. Refresh access details before trying again."));
      if (mounted.current && currentWorker.current === targetId) {
        refreshDeferred.current = false;
        if (validModeration(payload.moderation)) setRecord({ workerId: targetId, data: payload.moderation });
        setSelection(null);
        setNotice({ kind: "success", text: SUCCESS_LABELS[target.action] });
        setRevision((value) => value + 1);
      }
      try { await callbackRef.current(); } catch {
        if (mounted.current && currentWorker.current === targetId) setNotice({ kind: "success", text: `${SUCCESS_LABELS[target.action]} Refresh the worker directory to see the latest totals.` });
      }
    } catch (error) {
      if (mounted.current && currentWorker.current === targetId) {
        setNotice({ kind: "error", text: timedOut ? "The request timed out. Access details are being refreshed; confirm the current state before trying again." : error instanceof Error ? error.message : "The request failed. Refresh access details before trying again." });
        setSelection(null);
        setRevision((value) => value + 1);
      }
    } finally {
      window.clearTimeout(timeout);
      if (mutationController.current === controller) mutationController.current = null;
      if (mounted.current && currentWorker.current === targetId) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  };

  return (
    <section className={styles.panel} aria-labelledby={headingId} aria-busy={loading || pending}>
      <div className={styles.header}>
        <div><h3 id={headingId}>Access & safety</h3><p className={styles.intro}>Pause, restore or remove this user’s access, and review where they signed in from.</p></div>
        {moderation ? <span className={styles.lastSeen}>{moderation.lastSeenAt ? `Last seen ${dateLabel(moderation.lastSeenAt)}` : "No recorded visits yet"}</span> : null}
      </div>

      <div aria-live="polite" aria-atomic="true">
        {notice && <div className={`${styles.notice} ${notice.kind === "success" ? styles.success : styles.error}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</div>}
        {pending && <p className={styles.loading} role="status"><span className={styles.spinner} />Saving access changes…</p>}
      </div>

      {loading && !moderation ? <div className={styles.loading} role="status"><span className={styles.spinner} />Loading access details…</div> : null}
      {loadError && <div className={`${styles.notice} ${styles.error}`} role="alert"><span>{loadError}</span><button className={styles.textButton} type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading || pending}>Retry</button></div>}

      {moderation && <>
        {status !== "active" && <div className={styles.statusSummary}>
          <strong>{status === "deleted" ? moderation.purgeStartedAt ? "Permanent deletion has started" : "This user is scheduled for permanent deletion" : "This user’s access is suspended"}</strong>
          <p>{status === "deleted" ? moderation.purgeStartedAt ? "Files and account records are being removed. This account can no longer be restored." : "Access is disabled. Account records, files and sign-in access will be permanently removed after the 7-day restore window." : "Protected actions are blocked until an administrator restores access."}</p>
          {moderation.reason && <p className={styles.reason}><span>Recorded reason</span>{moderation.reason}</p>}
          <p className={styles.meta}>{status === "deleted" ? "Deleted" : "Suspended"} {dateLabel(status === "deleted" ? moderation.deletedAt : moderation.suspendedAt)}</p>
          {status === "deleted" && moderation.purgeAfter ? <p className={styles.meta}>Permanent removal after <time dateTime={moderation.purgeAfter}>{dateLabel(moderation.purgeAfter)}</time></p> : null}
          {moderation.cleanupStatus === "retry" ? <p className={styles.meta}>Automatic cleanup will retry{moderation.cleanupRetryAt ? ` after ${dateLabel(moderation.cleanupRetryAt)}` : " shortly"}. Removal has not been marked complete.</p> : null}
        </div>}

        <div className={styles.actionGrid}>
          {status === "active" ? <button type="button" className={styles.actionButton} disabled={!canAct} onClick={() => setSelection({ action: "suspend" })}>
            <span className={styles.actionIcon}><ShieldIcon variant="pause" /></span><span><strong>Suspend access</strong><small>Pause sign-in and protected actions</small></span>
          </button> : <button type="button" className={`${styles.actionButton} ${styles.restoreButton}`} disabled={!canAct || !!moderation.purgeStartedAt} onClick={() => setSelection({ action: "restore" })}>
            <span className={styles.actionIcon}><ShieldIcon variant="restore" /></span><span><strong>Restore access</strong><small>{moderation.purgeStartedAt ? "Permanent deletion has started" : status === "deleted" ? "Cancel scheduled permanent deletion" : "Allow this user to return"}</small></span>
          </button>}
          {status !== "deleted" && <button type="button" className={styles.actionButton} disabled={!canAct || eligibleIps.length === 0 || moderation.canBlockIps === false} onClick={() => setSelection({ action: "suspend_ip" })} aria-describedby={eligibleIps.length === 0 || moderation.canBlockIps === false ? `${headingId}-ip-help` : undefined}>
            <span className={styles.actionIcon}><ShieldIcon variant="network" /></span><span><strong>Suspend + block IP</strong><small>{eligibleIps.length === 0 || moderation.canBlockIps === false ? "Needs a recorded public IP" : "Choose a recorded connection"}</small></span>
          </button>}
        </div>

        <details className={styles.networkSection}>
          <summary className={styles.disclosureHeading}><ShieldIcon variant="network" /><span>Recorded IP addresses</span><span className={styles.count}>{knownIps.length}</span>{blockedCount > 0 && <span className={styles.blockCount}>{blockedCount} blocked</span>}</summary>
          <div className={styles.networkBody}>
          <p className={styles.meta}>Times shown in your local time zone</p>
          {knownIps.length > 0 && moderation.canBlockIps === false && <p id={`${headingId}-ip-help`} className={styles.networkHelp}>IP blocking is unavailable because your current connection cannot be verified. User suspension is still available.</p>}
          {knownIps.length > 0 && eligibleIps.length === 0 && moderation.canBlockIps !== false && <p id={`${headingId}-ip-help`} className={styles.networkHelp}>No eligible public IP addresses are available to block. Private addresses and your current connection are protected.</p>}
          {knownIps.length === 0 ? <div id={`${headingId}-ip-help`} className={styles.emptyState}>
            <ShieldIcon variant="network" /><div><strong>No verified IP addresses yet</strong><p>{moderation.ipTrackingEnabled === false ? "Trusted IP capture is not configured for this environment. IP blocking becomes available after trusted connection addresses are recorded." : "Addresses will appear after this user makes a request through a trusted connection. You can suspend their access now."}</p></div>
          </div> : <>
            <p className={styles.networkHelp}>IP addresses can be shared by households, offices or mobile networks. Review carefully before blocking.</p>
            <ul className={styles.ipList} aria-label="Recorded IP addresses">
              {knownIps.map((item) => <li key={item.ip} className={styles.ipRow}>
                <div className={styles.ipInfo}><code>{item.ip}</code><span>Last seen {dateLabel(item.lastSeenAt)}</span></div>
                <div className={styles.ipActions}><span className={`${styles.miniBadge} ${item.blocked ? styles.blocked : styles.observed}`}>{item.blocked ? "Blocked" : "Observed"}</span>{item.blocked && <button className={styles.smallButton} disabled={!canAct} type="button" onClick={() => setSelection({ action: "unblock_ip", ip: item.ip })} aria-label={`Unblock IP address ${item.ip}`}>Unblock</button>}</div>
              </li>)}
            </ul>
          </>}
          {blockedCount > 0 && <p className={styles.networkHelp}>Restoring this user also removes IP blocks recorded for them. Blocks recorded for other users remain.</p>}
          </div>
        </details>

        <details className={styles.history}>
          <summary className={styles.disclosureHeading}><ShieldIcon variant="restore" /><span>Moderation history</span><span className={styles.count}>{Math.min(moderation.history.length, 20)}</span></summary>
          {moderation.history.length ? <ol className={styles.timeline}>{moderation.history.slice(0, 20).map((entry) => <li key={entry.id}>
            <div className={styles.timelineTitle}><strong>{historyLabel(entry.action)}</strong><time dateTime={entry.createdAt}>{dateLabel(entry.createdAt)}</time></div>
            <p>{entry.reason}</p>{entry.actorLabel && <span className={styles.meta}>By {entry.actorLabel}</span>}
          </li>)}</ol> : <p className={styles.historyEmpty}>No moderation actions recorded.</p>}
        </details>

        {status !== "deleted" && <details className={styles.dangerSection}>
          <summary className={styles.disclosureHeading}><ShieldIcon variant="archive" /><span>Delete user</span></summary>
          <div className={styles.dangerContent}><p>Disable access now and schedule permanent removal of account records, files and sign-in access after 7 days. Restore access before automatic cleanup begins to cancel removal.</p><button type="button" className={styles.dangerOutline} disabled={!canAct} onClick={() => setSelection({ action: "delete" })}>Delete user…</button></div>
        </details>}
      </>}
      {selection && <ConfirmDialog key={`${worker.id}:${selection.action}:${selection.ip ?? ""}`} worker={worker} selection={selection} knownIps={eligibleIps} pending={pending} onClose={closeDialog} onConfirm={mutate} />}
    </section>
  );
}

function ConfirmDialog({ worker, selection, knownIps, pending, onClose, onConfirm }: {
  worker: WorkerAccess;
  selection: Selection;
  knownIps: Moderation["knownIps"];
  pending: boolean;
  onClose: () => void;
  onConfirm: (selection: Selection, reason: string, confirmation: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const progress = useRef<HTMLParagraphElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const confirmationId = useId();
  const selectedIpId = useId();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [sharedNetworkConfirmed, setSharedNetworkConfirmed] = useState(false);
  const [selectedIp, setSelectedIp] = useState(selection.ip ?? "");
  const action = selection.action;
  const destructive = action === "delete" || action === "suspend_ip";

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    reasonInput.current?.focus();
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => { if (pending) progress.current?.focus(); }, [pending]);

  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex="0"]');
    if (!focusable?.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const reasonValid = reason.trim().length >= 8 && reason.trim().length <= 1000;
  const valid = reasonValid && (action !== "delete" || confirmation.trim() === worker.id) && (action !== "suspend_ip" || (sharedNetworkConfirmed && knownIps.some((item) => item.ip === selectedIp)));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && !pending) void onConfirm(action === "suspend_ip" ? { ...selection, ip: selectedIp } : selection, reason, confirmation);
  };

  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={pending} onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }} onKeyDown={trapFocus}>
    <form onSubmit={submit} className={styles.dialogForm}>
      <div className={styles.dialogHeader}><span className={`${styles.dialogIcon} ${destructive ? styles.dangerIcon : ""}`}><ShieldIcon variant={action === "delete" ? "archive" : action === "restore" ? "restore" : action === "suspend_ip" || action === "unblock_ip" ? "network" : "pause"} /></span><button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close confirmation" disabled={pending}><ShieldIcon variant="close" /></button></div>
      <h3 id={titleId}>{ACTION_LABELS[action]}{action === "delete" ? "?" : ""}</h3>
      <div className={styles.dialogIdentity}><strong>{worker.name}</strong><span>{worker.id}{worker.email ? ` · ${worker.email}` : ""}</span></div>
      <p id={descriptionId} className={styles.dialogDescription}>
        {action === "suspend" && "Block this user’s protected actions until an administrator restores access. Their work and payment records are retained."}
        {action === "suspend_ip" && "Suspend this user and block one recorded IP address you select below. Other users connecting from the same address will also be affected."}
        {action === "restore" && "Allow this user to access their account again and remove IP blocks recorded for them. Blocks recorded for other users remain, including any shared IP addresses."}
        {action === "delete" && "This disables access immediately and schedules permanent removal of account records, uploaded files and sign-in access after 7 days. Restore access before cleanup starts to cancel deletion. Permanent removal cannot be undone."}
        {action === "unblock_ip" && <>Remove the block recorded for this user on <code>{selection.ip}</code>. Blocks recorded for other users at this address may still apply. This user’s suspension or archived status will stay the same.</>}
      </p>
      {action === "suspend_ip" && <><label htmlFor={selectedIpId} className={styles.fieldLabel}>IP address to block <span>Required</span></label><select id={selectedIpId} className={styles.confirmationInput} value={selectedIp} onChange={(event) => setSelectedIp(event.target.value)} required disabled={pending}><option value="">Choose a recorded IP address</option>{knownIps.map((item) => <option key={item.ip} value={item.ip}>{item.ip} · {item.blocked ? "Already blocked" : "Last seen " + dateLabel(item.lastSeenAt)}</option>)}</select><label className={styles.warning}><input type="checkbox" checked={sharedNetworkConfirmed} onChange={(event) => setSharedNetworkConfirmed(event.target.checked)} required disabled={pending} /><span>I understand that a shared IP block can affect other users on the same household, office or mobile network.</span></label></>}
      <label htmlFor={reasonId} className={styles.fieldLabel}>Reason <span>Required</span></label>
      <textarea id={reasonId} ref={reasonInput} className={styles.textarea} value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={1000} required disabled={pending} rows={3} placeholder={action === "restore" || action === "unblock_ip" ? "Explain what was reviewed and why access can be restored…" : "Describe the issue and why this action is necessary…"} aria-describedby={`${reasonId}-hint`} />
      <p id={`${reasonId}-hint`} className={styles.fieldHint}><span>8–1,000 characters · Saved in moderation history</span><span>{reason.length}/1,000</span></p>
      {action === "delete" && <div className={styles.confirmationField}><label htmlFor={confirmationId} className={styles.fieldLabel}>Type <code>{worker.id}</code> to confirm</label><input id={confirmationId} className={styles.confirmationInput} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} required disabled={pending} placeholder={worker.id} /></div>}
      {pending && <p ref={progress} tabIndex={0} className={styles.loading} role="status">Saving changes. Please wait for confirmation…</p>}
      <div className={styles.dialogFooter}><button type="button" className={styles.cancelButton} onClick={onClose} disabled={pending}>Cancel</button><button type="submit" className={`${styles.confirmButton} ${destructive ? styles.destructiveButton : ""}`} disabled={!valid || pending}>{pending ? <><span className={styles.spinner} />Saving…</> : ACTION_LABELS[action]}</button></div>
    </form>
  </dialog>, document.body);
}
