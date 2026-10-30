"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useVisibleRefresh } from "@/lib/useVisibleRefresh";
import { workerDeletionLabel } from "@/lib/workerDeletion";
import {
  filterWorkerDirectory, MAX_WORKER_SELECTION, updateWorkerSelection, workerAccessStatus, workerDirectoryCsv,
  type WorkerDirectoryFilter, type WorkerDirectoryRecord, type WorkerDirectorySort,
} from "@/lib/adminWorkerDirectory";
import WorkerBulkActions from "./WorkerBulkActions";
import { WorkerGlyph, workerInitials } from "./WorkerWorkspace";
import styles from "./WorkerDirectory.module.css";

type Props = {
  workers: WorkerDirectoryRecord[];
  selectedWorkerId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void | Promise<void>;
  onVerifyUpi: (id: string, reviewedUpiId: string) => void | Promise<void>;
};

function PageCheckbox({ checked, mixed, disabled, onChange }: { checked: boolean; mixed: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <input ref={input} type="checkbox" aria-label="Select users on this page" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />;
}

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

function UpiReview({ worker, onVerify }: { worker: WorkerDirectoryRecord; onVerify: Props["onVerifyUpi"] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const panelId = useId();
  const review = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (open) confirm.current?.focus(); }, [open]);
  const cancel = () => { setOpen(false); review.current?.focus(); };
  const verify = async () => {
    if (running.current || !worker.upiId) return;
    running.current = true;
    setBusy(true);
    try { await onVerify(worker.id, worker.upiId); }
    finally {
      running.current = false;
      if (mounted.current) { setBusy(false); cancel(); }
    }
  };
  return <div className={`${styles.upiReview} ${open ? styles.upiReviewOpen : ""}`}>
    <span className={styles.chipPending}>UPI unverified<button ref={review} type="button" disabled={busy} aria-expanded={open} aria-controls={panelId} aria-label={`Review payout UPI for ${worker.name}`} onClick={() => open ? cancel() : setOpen(true)}>Review</button></span>
    {open ? <div id={panelId} className={styles.upiConfirmation} onKeyDown={event => { if (event.key === "Escape" && !busy) { event.stopPropagation(); cancel(); } }}>
      <strong>Verify payout UPI for {worker.name}</strong>
      <code>{worker.upiId}</code>
      <p>Confirm only after checking this exact payout address.</p>
      <div><button type="button" disabled={busy} onClick={cancel}>Cancel</button><button ref={confirm} type="button" disabled={busy} aria-label={`Confirm ${worker.upiId} as verified for ${worker.name}`} onClick={() => void verify()}>{busy ? "Verifying…" : "Confirm verified"}</button></div>
    </div> : null}
  </div>;
}

export default function WorkerDirectory({ workers, selectedWorkerId, onSelect, onRefresh, onVerifyUpi }: Props) {
  const id = useId();
  const [status, setStatus] = useState<WorkerDirectoryFilter>("current");
  const [assignment, setAssignment] = useState<"all" | "assigned" | "unassigned">("all");
  const [payment, setPayment] = useState<"all" | "verified" | "unverified">("all");
  const [sort, setSort] = useState<WorkerDirectorySort>("name_asc");
  const [localSearch, setLocalSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tick = useCallback(async () => { setNow(Date.now()); }, []);
  useVisibleRefresh(tick, 60_000);
  const query = localSearch;
  const filtered = useMemo(() => filterWorkerDirectory(workers, { query, status, assignment, payment, sort }), [workers, query, status, assignment, payment, sort]);
  const filterKey = JSON.stringify([query, status, assignment, payment, sort, pageSize]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageCount, pagination.key === filterKey ? pagination.page : 1);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const knownIds = new Set(workers.map(worker => worker.id));
  const effectiveSelection = new Set([...selected].filter(workerId => knownIds.has(workerId)));
  const selectedWorkers = workers.filter(worker => effectiveSelection.has(worker.id));
  const matchingIds = new Set(filtered.map(worker => worker.id));
  const hiddenCount = selectedWorkers.filter(worker => !matchingIds.has(worker.id)).length;
  const pageSelected = pageRows.filter(worker => effectiveSelection.has(worker.id)).length;
  const counts = useMemo(() => {
    const result = { current: 0, all: workers.length, active: 0, suspended: 0, deleted: 0 };
    for (const worker of workers) { const access = workerAccessStatus(worker); result[access]++; if (access !== "deleted") result.current++; }
    return result;
  }, [workers]);

  const changeSelection = (ids: string[], checked: boolean) => {
    const result = updateWorkerSelection(effectiveSelection, ids, checked);
    setSelected(result.ids);
    setNotice(result.limitReached ? `The batch limit is ${MAX_WORKER_SELECTION} users. Your first ${MAX_WORKER_SELECTION} selections are retained; remaining users are unselected.` : null);
  };
  const extraFilters = Number(assignment !== "all") + Number(payment !== "all") + Number(sort !== "name_asc") + Number(status === "all");
  const hasFilters = !!localSearch || extraFilters > 0 || status !== "current";
  const resetFilters = () => { setLocalSearch(""); setAssignment("all"); setPayment("all"); setStatus("current"); setSort("name_asc"); };
  const exportSelection = () => {
    const url = URL.createObjectURL(new Blob([workerDirectoryCsv(selectedWorkers)], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `reelencer-selected-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setNotice(`Exported ${selectedWorkers.length} selected ${selectedWorkers.length === 1 ? "user" : "users"}.`);
  };

  return <div className={styles.directory}>
    <div className={styles.tabs} role="group" aria-label="Filter workers by access status">
      {([["current", "Current"], ["active", "Active"], ["suspended", "Suspended"], ["deleted", "Deleted"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={status === value} className={`${status === value ? styles.activeTab : ""} ${value !== "current" && value !== "active" && counts[value] > 0 ? styles.tabAlert : ""}`} onClick={() => setStatus(value)}><span className={styles.tabCount}>{counts[value]}</span><span className={styles.tabLabel}>{label}</span></button>)}
    </div>

    <div className={styles.searchRow}>
      <label className={styles.search} htmlFor={`${id}-search`}><span className={styles.visuallyHidden}>Search users</span><WorkerGlyph name="search" /><input id={`${id}-search`} type="search" value={localSearch} onChange={event => setLocalSearch(event.target.value)} placeholder="Search name, email or ID" /></label>
      <button type="button" className={styles.filterToggle} aria-label={extraFilters ? `Filters (${extraFilters} applied)` : "Filters"} title="Filter and sort users" aria-expanded={filtersOpen} aria-controls={`${id}-filters`} onClick={() => setFiltersOpen(open => !open)}><WorkerGlyph name="filter" /><span>Filters</span>{extraFilters > 0 ? <b>{extraFilters}</b> : null}</button>
    </div>
    <div id={`${id}-filters`} className={styles.filters} hidden={!filtersOpen}>
      <label htmlFor={`${id}-status`}><span>Access</span><select id={`${id}-status`} value={status} onChange={event => setStatus(event.target.value as WorkerDirectoryFilter)}><option value="current">Current team</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deleted">Pending removal</option><option value="all">All records ({counts.all})</option></select></label>
      <label htmlFor={`${id}-assignment`}><span>Assignments</span><select id={`${id}-assignment`} value={assignment} onChange={event => setAssignment(event.target.value as typeof assignment)}><option value="all">Any assignment</option><option value="assigned">Has accounts</option><option value="unassigned">No accounts</option></select></label>
      <label htmlFor={`${id}-payment`}><span>Payment details</span><select id={`${id}-payment`} value={payment} onChange={event => setPayment(event.target.value as typeof payment)}><option value="all">Any verification</option><option value="verified">UPI verified</option><option value="unverified">UPI not verified</option></select></label>
      <label htmlFor={`${id}-sort`}><span>Sort users</span><select id={`${id}-sort`} value={sort} onChange={event => setSort(event.target.value as WorkerDirectorySort)}><option value="name_asc">Name: A–Z</option><option value="name_desc">Name: Z–A</option><option value="earnings">Highest approved earnings</option><option value="accounts">Most assigned accounts</option><option value="submissions">Most submissions</option><option value="resubmits">Most resubmits</option></select></label>
    </div>
    {hasFilters ? <div className={styles.filterSummary}><span>{extraFilters > 0 ? `${extraFilters} additional ${extraFilters === 1 ? "filter" : "filters"} applied` : "Filtered directory"}</span><button type="button" className={styles.reset} onClick={resetFilters}>Reset filters</button></div> : null}

    <div className={styles.toolbar}>
      <label className={styles.pageSelect}><PageCheckbox checked={pageRows.length > 0 && pageSelected === pageRows.length} mixed={pageSelected > 0 && pageSelected < pageRows.length} disabled={!pageRows.length} onChange={checked => changeSelection(pageRows.map(worker => worker.id), checked)} /><span><strong>{filtered.length}</strong> {filtered.length === 1 ? "user" : "users"}{status === "all" ? <small> · incl. deleted</small> : null}{pageCount > 1 ? <small> · page {page} of {pageCount}</small> : null}</span></label>
      {filtered.length > pageRows.length ? <button type="button" className={styles.linkButton} onClick={() => changeSelection(filtered.map(worker => worker.id), true)}>Select all {Math.min(filtered.length, MAX_WORKER_SELECTION)}</button> : null}
    </div>

    {selectedWorkers.length > 0 && <div className={styles.selectedSummary} role="status"><div><strong>{selectedWorkers.length} selected</strong><span>{hiddenCount > 0 ? `${hiddenCount} hidden by filters · ` : ""}Kept across pages and filters</span></div><button type="button" className={styles.linkButton} onClick={exportSelection}>Export CSV</button></div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}

    <WorkerBulkActions workers={selectedWorkers} onClear={() => { setSelected(new Set()); setNotice(null); }} onCompleted={async result => {
      const completed = new Set(result.items.filter(item => item.status === "success").map(item => item.workerId));
      setSelected(previous => new Set([...previous].filter(workerId => !completed.has(workerId))));
      await onRefresh();
    }} />

    {status === "deleted" ? <p className={styles.retentionNotice}>Deleted users and their files are permanently removed after 7 days. Restore access before automatic cleanup begins to cancel removal.</p> : null}

    <div className={styles.rows} aria-label="User directory">
      {pageRows.map(worker => {
        const access = workerAccessStatus(worker);
        const open = selectedWorkerId === worker.id;
        const activity = [
          worker.accountCount ? `${worker.accountCount} ${worker.accountCount === 1 ? "account" : "accounts"}` : null,
          worker.submittedCount ? `${worker.submittedCount} submitted` : null,
        ].filter(Boolean).join(" · ");
        return <article key={worker.id} className={`${styles.row} ${open ? styles.openRow : ""} ${effectiveSelection.has(worker.id) ? styles.selectedRow : ""}`}>
          <label className={styles.rowCheck}><input type="checkbox" aria-label={`Select ${worker.name} (${worker.id})`} checked={effectiveSelection.has(worker.id)} onChange={event => changeSelection([worker.id], event.target.checked)} /></label>
          <div className={styles.rowMain}>
            <button type="button" className={styles.openUser} onClick={() => onSelect(worker.id)} aria-label={`Manage ${worker.name} (${worker.id})`} aria-pressed={open}>
              <span className={styles.avatar} aria-hidden="true">{workerInitials(worker.name)}<i className={styles[access]} /></span>
              <span className={styles.identity}>
                <span className={styles.identityTitle}><strong title={worker.name}>{worker.name}</strong>{access !== "active" ? <span className={`${styles.status} ${styles[access]}`}>{access === "deleted" ? "Deleted" : "Suspended"}</span> : null}</span>
                <span className={styles.identityMeta}><span className={styles.workerId}>{worker.id}</span>{worker.email ? <small title={worker.email}>{worker.email}</small> : null}</span>
              </span>
              <span className={`${styles.rowEarnings} ${worker.approvedINR ? "" : styles.zero}`} title="Approved earnings">{currency.format(worker.approvedINR)}</span>
              <WorkerGlyph name="arrow" className={styles.openArrow} />
            </button>
            <div className={styles.rowFoot}>
              <span className={activity ? styles.activity : styles.noActivity}>{activity || "No work yet"}</span>
              {worker.resubmitCount > 0 ? <span className={styles.chipWarn}>{worker.resubmitCount} {worker.resubmitCount === 1 ? "resubmit" : "resubmits"}</span> : null}
              {worker.upiId ? worker.upiVerified
                ? <span className={styles.chipOk} title={`UPI ${worker.upiId}`}>UPI verified</span>
                : <UpiReview key={`${worker.id}:${worker.upiId}`} worker={worker} onVerify={onVerifyUpi} />
                : null}
            </div>
            {access === "deleted" ? <p className={styles.deletionDeadline}>
              <span>{workerDeletionLabel(worker.purgeAfter, worker.purgeStartedAt, now)}</span>
              {worker.purgeAfter ? <time dateTime={worker.purgeAfter}>{new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(worker.purgeAfter))}</time> : null}
            </p> : null}
          </div>
        </article>;
      })}
      {pageRows.length === 0 && <div className={styles.empty}><WorkerGlyph name="search" /><strong>No users match these filters</strong><p>Try another name, worker ID or access status.</p>{hasFilters ? <button type="button" onClick={resetFilters}>Clear filters</button> : null}</div>}
    </div>

    <div className={styles.pagination} aria-label="User directory pagination">
      <label htmlFor={`${id}-page-size`}>Per page<select id={`${id}-page-size`} value={pageSize} onChange={event => setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      <span>{filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span>
      <div><button type="button" aria-label="Previous page of users" disabled={page === 1} onClick={() => setPagination({ key: filterKey, page: page - 1 })}>Previous</button><span aria-live="polite">{page} / {pageCount}</span><button type="button" aria-label="Next page of users" disabled={page === pageCount} onClick={() => setPagination({ key: filterKey, page: page + 1 })}>Next</button></div>
    </div>
  </div>;
}
