"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { isCurrentAdminCacheIdentity } from "@/lib/adminCacheIdentity";
import { invalidateAdminUpiQueue, pendingUpiCacheKey } from "@/lib/adminUpiCache";
import { useAdminCachedResource } from "@/lib/useAdminCachedResource";
import { useAdminLive } from "@/lib/useAdminLive";
import type { AdminPendingUpiConfig } from "@/lib/adminUpiQueue";
import { destinationLabel, parseDestination } from "@/lib/payoutDestination";
import styles from "./AdminUpiQueue.module.css";

type Queue = { ok: true; pendingCount: number; upiConfigs: AdminPendingUpiConfig[] };
function isQueue(value: unknown): value is Queue {
  if (!value || typeof value !== "object") return false;
  const queue = value as Queue;
  return queue.ok === true && Number.isSafeInteger(queue.pendingCount) && queue.pendingCount >= 0 &&
    Array.isArray(queue.upiConfigs) && queue.upiConfigs.length <= 20 && queue.upiConfigs.length <= queue.pendingCount &&
    new Set(queue.upiConfigs.map(row => row?.workerId)).size === queue.upiConfigs.length &&
    queue.upiConfigs.every(row => row && typeof row.workerId === "string" && row.workerId &&
      typeof row.workerCode === "string" && typeof row.workerName === "string" &&
      typeof row.upiId === "string" && row.upiId.trim() && row.verified === false &&
      typeof row.payoutSchedule === "string" && typeof row.payoutDay === "string" &&
      (row.updatedAt === undefined || typeof row.updatedAt === "string" && Number.isFinite(Date.parse(row.updatedAt))));
}

const days: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
function schedule(row: AdminPendingUpiConfig) {
  return row.payoutSchedule === "Monthly" ? `Monthly · Day ${row.payoutDay}` : `Weekly · ${days[row.payoutDay] ?? row.payoutDay}`;
}
/** Bank accounts read as "Bank A/c 1234567890 · HDFC0001234", with the holder's name beneath. */
function destination(row: AdminPendingUpiConfig) {
  const parsed = parseDestination(row.upiId);
  return parsed?.method === "Bank"
    ? { kind: "Bank account", text: destinationLabel(row.upiId, { full: true }), holder: row.bankHolderName }
    : { kind: "UPI", text: row.upiId, holder: undefined };
}
function savedTime(at?: string) {
  return at ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(at)) + " IST" : "Save time unavailable";
}
function Icon({ refresh = false }: { refresh?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{refresh ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></> : <><rect x="3" y="6" width="18" height="15" rx="3" /><path d="M3 9V5a2 2 0 0 1 2-2h12v3m4 5h-5v5h5m-3-2.5h.01" /></>}</svg>;
}

function ReviewRow({ row, busy, disabled, onVerify, onOpen }: {
  row: AdminPendingUpiConfig; busy: boolean; disabled: boolean;
  onVerify: (row: AdminPendingUpiConfig) => Promise<boolean>; onOpen: (code: string) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const id = useId();
  const reviewButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancel = () => { setReviewing(false); reviewButton.current?.focus(); };
  const open = () => { setReviewing(true); };
  useEffect(() => { if (reviewing) confirmButton.current?.focus(); }, [reviewing]);
  return <li className={`${styles.row} ${reviewing ? styles.reviewing : ""}`}>
    <div className={styles.rowMain}>
      <div className={styles.creator}><span className={styles.avatar} aria-hidden="true">{(row.workerName.trim() || "C").slice(0, 1).toUpperCase()}</span><div><button type="button" className={styles.creatorLink} onClick={() => onOpen(row.workerCode)} title={`Open ${row.workerName}'s details`}>{row.workerName}</button><span className={styles.code}>{row.workerCode}</span></div></div>
      <div className={styles.payment}><strong>{destination(row).text}</strong><span>{destination(row).holder ? `${destination(row).kind} · ${destination(row).holder}` : `${destination(row).kind} · ${schedule(row)}`}</span></div>
      <div className={styles.saved}><span className={styles.pending}><i />Needs verification</span><time dateTime={row.updatedAt}>{row.updatedAt ? "Saved " : ""}{savedTime(row.updatedAt)}</time></div>
      <button type="button" ref={reviewButton} className={styles.reviewButton} onClick={reviewing ? cancel : open} aria-expanded={reviewing} aria-controls={id} disabled={disabled}>{busy ? "Verifying…" : reviewing ? "Close review" : destination(row).kind === "UPI" ? "Review UPI" : "Review bank"}<span aria-hidden="true">→</span></button>
    </div>
    {reviewing ? <div id={id} className={styles.confirmation} onKeyDown={event => { if (event.key === "Escape" && !busy) cancel(); }}>
      <div><strong>{destination(row).kind === "UPI" ? "Have you checked this payout UPI?" : "Have you checked this bank account?"}</strong><p>Confirm <b>{destination(row).text}</b>{destination(row).holder ? <> in the name of <b>{destination(row).holder}</b></> : null} for {row.workerName} after your review{destination(row).kind === "UPI" ? "" : ": the holder’s name should match the creator’s KYC"}. Verification updates the creator’s payout status.</p></div>
      <div className={styles.confirmActions}><button type="button" onClick={cancel} disabled={busy} className={styles.cancelButton}>Cancel</button><button ref={confirmButton} type="button" className={styles.confirmButton} disabled={disabled} onClick={async () => { if (await onVerify(row)) setReviewing(false); }}>{busy ? "Verifying…" : "Confirm verified"}</button></div>
    </div> : null}
  </li>;
}

export default function AdminUpiQueue({ adminId, onOpenCreator }: { adminId: string; onOpenCreator: (workerCode: string) => void }) {
  const [limit, setLimit] = useState(5);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const mutation = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const read = useCallback(async (signal: AbortSignal) => {
    const response = await apiFetch(`/api/admin/upi-configs?status=pending&limit=${limit}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    const data: unknown = await response.json();
    if (!response.ok || !isQueue(data)) throw new Error("UPI verification requests could not be loaded.");
    return data;
  }, [limit]);
  // Payment addresses stay in memory and are cleared with the authenticated admin identity.
  const resource = useAdminCachedResource<Queue>({ scope: adminId, key: pendingUpiCacheKey(limit), load: read, ttlMs: 10_000, maxAgeMs: 60_000, persist: false, validate: isQueue });
  const refresh = resource.refresh;
  useAdminLive(true, kinds => {
    if (!kinds || kinds.has("upi_configs") || kinds.has("worker_moderation") || kinds.has("worker_deletion_jobs")) {
      invalidateAdminUpiQueue(adminId);
      void refresh({ afterCurrent: true });
    }
  }, { refreshOnConnect: false });
  useEffect(() => {
    const update = () => { invalidateAdminUpiQueue(adminId); void refresh({ afterCurrent: true }); };
    window.addEventListener("admin-overview-refresh", update);
    window.addEventListener("admin-upi-configs-updated", update);
    return () => { window.removeEventListener("admin-overview-refresh", update); window.removeEventListener("admin-upi-configs-updated", update); };
  }, [adminId, refresh]);

  const verify = async (row: AdminPendingUpiConfig) => {
    if (mutation.current || resource.error || !isCurrentAdminCacheIdentity(adminId)) return false;
    mutation.current = true;
    setBusyId(row.workerId);
    setMessage(null);
    let verified = false;
    try {
      const response = await apiFetch("/api/admin/upi-configs", { method: "PATCH", body: JSON.stringify({ workerId: row.workerId, upiId: row.upiId, verified: true }), signal: AbortSignal.timeout(20_000) });
      const result = await response.json().catch(() => null);
      if (!mounted.current || !isCurrentAdminCacheIdentity(adminId)) return false;
      if (!response.ok || !result?.ok) {
        if (response.status === 409 || response.status === 404) throw new Error("These payout details changed. Review the refreshed UPI before verifying it.");
        throw new Error(response.status === 401 || response.status === 403 ? "Your admin session needs to be refreshed. Sign in again to verify this UPI." : "UPI verification could not be completed. Refresh and try again.");
      }
      if (result.upiConfig?.worker_id !== row.workerId || result.upiConfig?.upi_id !== row.upiId || result.upiConfig?.verified !== true) throw new Error("The verification result could not be confirmed. Refresh to check the current status.");
      verified = true;
      heading.current?.focus({ preventScroll: true });
      resource.update(previous => {
        const current = previous ?? { ok: true as const, pendingCount: 0, upiConfigs: [] };
        const remaining = current.upiConfigs.filter(item => item.workerId !== row.workerId || item.upiId !== row.upiId);
        return { ...current, upiConfigs: remaining, pendingCount: Math.max(0, current.pendingCount - (current.upiConfigs.length - remaining.length)) };
      });
      setMessage({ tone: "success", text: `${destination(row).kind === "UPI" ? "Payout UPI" : "Bank account"} verified for ${row.workerName}. The creator’s status will update automatically.` });
      window.dispatchEvent(new Event("admin-upi-configs-updated"));
    } catch (error) {
      if (mounted.current && isCurrentAdminCacheIdentity(adminId)) setMessage({ tone: "error", text: error instanceof Error && error.name !== "TimeoutError" ? error.message : "The request timed out. Refresh to check whether the UPI was verified." });
    } finally {
      if (mounted.current && isCurrentAdminCacheIdentity(adminId)) {
        await refresh({ afterCurrent: true });
        mutation.current = false;
        if (mounted.current && isCurrentAdminCacheIdentity(adminId)) setBusyId(null);
      }
    }
    return verified;
  };
  const data = resource.data;
  return <section className={styles.card} aria-labelledby="admin-upi-title">
    <div className={styles.heading}><span className={styles.icon}><Icon /></span><div className={styles.headingText}><h3 id="admin-upi-title" ref={heading} tabIndex={-1}>Payout details verification <span className={styles.count} aria-label={data ? `${data.pendingCount} pending` : "Loading pending count"}>{data ? data.pendingCount.toLocaleString("en-IN") : "–"}</span></h3><p>Creator payment details waiting for your review.</p></div><button type="button" className={styles.refresh} aria-label="Refresh UPI queue" title="Refresh UPI queue" disabled={resource.refreshing || busyId !== null} onClick={() => void refresh({ afterCurrent: true })}><Icon refresh /></button></div>
    {message ? <div role="status" className={`${styles.notice} ${message.tone === "success" ? styles.success : ""}`}>{message.text}</div> : null}
    {resource.error ? <div role="alert" className={styles.notice}><span>{data ? "Showing the last loaded requests. Refresh before verifying payment details." : "UPI requests could not be loaded. Please try again."}</span><button type="button" onClick={() => void refresh({ afterCurrent: true })}>Try again</button></div> : null}
    {data?.upiConfigs.length ? <ul className={styles.list} aria-label="Pending UPI verifications" aria-busy={resource.refreshing}>{data.upiConfigs.map(row => <ReviewRow key={`${row.workerId}:${row.upiId}`} row={row} busy={busyId === row.workerId} disabled={busyId !== null || Boolean(resource.error)} onVerify={verify} onOpen={onOpenCreator} />)}</ul> : <div className={styles.empty} role="status"><span aria-hidden="true">{resource.loading ? "◌" : resource.error ? "!" : "✓"}</span><div><strong>{resource.loading ? "Loading UPI requests…" : resource.error ? "Verification queue unavailable" : "All payout details are reviewed"}</strong><p>{resource.loading ? "Checking the latest saved payment details." : resource.error ? "Retry to see the current requests." : "New or changed bank accounts and UPI IDs will appear here automatically."}</p></div></div>}
    {data && data.pendingCount > data.upiConfigs.length ? <div className={styles.footer}><span>Showing {data.upiConfigs.length} of {data.pendingCount.toLocaleString("en-IN")} pending · Latest saves first</span>{limit === 5 ? <button type="button" disabled={busyId !== null} onClick={() => setLimit(20)}>Show more requests →</button> : <button type="button" onClick={() => onOpenCreator("")}>View users →</button>}</div> : null}
  </section>;
}
