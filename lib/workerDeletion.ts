/** Deletion is reversible for seven complete days, then the background job erases the account. */
export const WORKER_DELETION_RETENTION_MS = 7 * 24 * 60 * 60_000;

export function workerPurgeAfter(deletedAt?: string | null): string | undefined {
  const deleted = deletedAt ? Date.parse(deletedAt) : NaN;
  return Number.isFinite(deleted) ? new Date(deleted + WORKER_DELETION_RETENTION_MS).toISOString() : undefined;
}

export function workerDeletionLabel(purgeAfter?: string | null, startedAt?: string | null, now = Date.now()) {
  if (startedAt) return "Permanent deletion in progress";
  const deadline = purgeAfter ? Date.parse(purgeAfter) : NaN;
  if (!Number.isFinite(deadline)) return "Deletion date unavailable";
  const remaining = deadline - now;
  if (remaining <= 0) return "Waiting for permanent deletion";
  const hours = Math.ceil(remaining / 3_600_000);
  return hours >= 24 ? `Permanent deletion in ${Math.ceil(hours / 24)} days` : `Permanent deletion in ${hours} ${hours === 1 ? "hour" : "hours"}`;
}
