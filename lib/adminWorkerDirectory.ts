export const MAX_WORKER_SELECTION = 100;

export type WorkerAccessStatus = "active" | "suspended" | "deleted";
export type WorkerDirectoryFilter = "current" | "all" | WorkerAccessStatus;
export type WorkerDirectorySort = "name_asc" | "name_desc" | "earnings" | "accounts" | "submissions";
export type WorkerDirectoryRecord = {
  id: string;
  userId?: string;
  name: string;
  email: string;
  active: boolean;
  moderationStatus?: WorkerAccessStatus;
  deletedAt?: string;
  purgeAfter?: string;
  purgeStartedAt?: string;
  accountCount: number;
  submittedCount: number;
  resubmitCount: number;
  approvedINR: number;
  upiId?: string;
  upiVerified?: boolean;
};

export function workerAccessStatus(worker: Pick<WorkerDirectoryRecord, "active" | "moderationStatus">): WorkerAccessStatus {
  if (worker.moderationStatus === "deleted" || worker.moderationStatus === "suspended") return worker.moderationStatus;
  return worker.active ? "active" : "suspended";
}

export function filterWorkerDirectory<T extends WorkerDirectoryRecord>(workers: readonly T[], options: {
  query?: string;
  status: WorkerDirectoryFilter;
  assignment: "all" | "assigned" | "unassigned";
  payment: "all" | "verified" | "unverified";
  sort: WorkerDirectorySort;
}): T[] {
  const terms = (options.query ?? "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return workers.filter(worker => {
    const status = workerAccessStatus(worker);
    if (options.status === "current" ? status === "deleted" : options.status !== "all" && options.status !== status) return false;
    if (options.assignment === "assigned" && worker.accountCount === 0) return false;
    if (options.assignment === "unassigned" && worker.accountCount > 0) return false;
    if (options.payment === "verified" && !worker.upiVerified) return false;
    if (options.payment === "unverified" && worker.upiVerified) return false;
    const searchable = [worker.name, worker.email, worker.id].join(" ").toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  }).sort((left, right) => {
    const name = left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }) || left.id.localeCompare(right.id);
    if (options.sort === "name_desc") return -name;
    if (options.sort === "earnings") return right.approvedINR - left.approvedINR || name;
    if (options.sort === "accounts") return right.accountCount - left.accountCount || name;
    if (options.sort === "submissions") return right.submittedCount - left.submittedCount || name;
    return name;
  });
}

/** Adds only explicitly supplied IDs and preserves selections on other pages and filters. */
export function updateWorkerSelection(selected: ReadonlySet<string>, ids: readonly string[], checked: boolean, limit = MAX_WORKER_SELECTION) {
  const next = new Set(selected);
  let limitReached = false;
  for (const id of new Set(ids)) {
    if (!checked) next.delete(id);
    else if (!next.has(id)) {
      if (next.size >= limit) limitReached = true;
      else next.add(id);
    }
  }
  return { ids: next, limitReached };
}

/** Always quote cells and neutralize spreadsheet formulas in user-supplied profile fields. */
export function safeWorkerCsvCell(value: unknown) {
  let text = String(value ?? "").replace(/\u0000/g, "");
  if (/^[\s\u0000-\u0020\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function workerDirectoryCsv(workers: readonly WorkerDirectoryRecord[]) {
  const rows: unknown[][] = [["Worker ID", "Name", "Email", "Access status", "Assigned accounts", "Submitted", "Resubmissions", "Approved earnings (INR)", "Payment verification"]];
  for (const worker of workers) rows.push([
    worker.id, worker.name, worker.email, workerAccessStatus(worker), worker.accountCount,
    worker.submittedCount, worker.resubmitCount, Number.isFinite(worker.approvedINR) ? worker.approvedINR.toFixed(2) : "0.00",
    worker.upiVerified ? "Verified" : "Unverified",
  ]);
  return "\uFEFF" + rows.map(row => row.map(safeWorkerCsvCell).join(",")).join("\r\n") + "\r\n";
}
