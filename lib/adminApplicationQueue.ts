export type ApplicationQueueSort = "latest" | "oldest" | "worker_asc" | "gig_asc";

export const APPLICATION_QUEUE_FILTERS = ["All", "Account sent", "Without account", "Pending", "Accepted", "Rejected", "Withdrawn"] as const;
export type ApplicationQueueFilter = typeof APPLICATION_QUEUE_FILTERS[number];

type QueueApplication = {
  id: string;
  gigId: string;
  workerId: string;
  workerName?: string;
  status?: string;
  appliedAt: string;
  proposal?: { accountSetup?: { submittedAt?: string; handle?: string } };
};

/** Account presence is independent of review status or missing legacy submission dates. */
export function hasApplicationAccount(app: Pick<QueueApplication, "proposal">) {
  return Boolean(app.proposal?.accountSetup?.handle?.trim());
}

export function matchesApplicationQueueFilter(app: Pick<QueueApplication, "status" | "proposal">, filter: ApplicationQueueFilter) {
  if (filter === "All") return true;
  if (filter === "Account sent") return hasApplicationAccount(app);
  if (filter === "Without account") return !hasApplicationAccount(app);
  if (filter === "Pending") return app.status === "Pending" || app.status === "Applied";
  return app.status === filter;
}

export function countApplicationQueueFilters(apps: readonly Pick<QueueApplication, "status" | "proposal">[]) {
  const counts = Object.fromEntries(APPLICATION_QUEUE_FILTERS.map(filter => [filter, 0])) as Record<ApplicationQueueFilter, number>;
  for (const app of apps) {
    for (const filter of APPLICATION_QUEUE_FILTERS) {
      if (matchesApplicationQueueFilter(app, filter)) counts[filter]++;
    }
  }
  return counts;
}

function validSubmissionTime(value?: string) {
  // Legacy account setups without a timestamp are represented by the Unix epoch.
  return value && Number.isFinite(Date.parse(value)) && Date.parse(value) > 0 ? value : undefined;
}

/** The creator's account submission (including resubmissions), never a bio check or recruiter edit. */
export function applicationQueueSubmission(app: Pick<QueueApplication, "appliedAt" | "proposal">) {
  const accountAt = hasApplicationAccount(app) ? validSubmissionTime(app.proposal?.accountSetup?.submittedAt) : undefined;
  return {
    at: accountAt ?? validSubmissionTime(app.appliedAt),
    source: accountAt ? "account" as const : "application" as const,
  };
}

/** One timeline for all applications: account submission time when available, otherwise application time. */
export function sortApplicationQueue<T extends QueueApplication>(
  apps: readonly T[],
  sort: ApplicationQueueSort,
  gigTitle: (gigId: string) => string | undefined = () => undefined,
): T[] {
  const direction = sort === "oldest" ? 1 : -1;
  return apps.map(app => {
    const submission = applicationQueueSubmission(app);
    return { app, time: submission.at ? Date.parse(submission.at) : undefined };
  }).sort((a, b) => {
    if (sort === "worker_asc") {
      const byWorker = String(a.app.workerName ?? a.app.workerId).localeCompare(String(b.app.workerName ?? b.app.workerId));
      if (byWorker) return byWorker;
    }
    if (sort === "gig_asc") {
      const byGig = (gigTitle(a.app.gigId) ?? a.app.gigId).localeCompare(gigTitle(b.app.gigId) ?? b.app.gigId);
      if (byGig) return byGig;
    }
    // Missing or malformed dates follow dated submissions in either direction.
    if (a.time === undefined && b.time !== undefined) return 1;
    if (b.time === undefined && a.time !== undefined) return -1;
    return direction * ((a.time ?? 0) - (b.time ?? 0)) || a.app.id.localeCompare(b.app.id);
  }).map(({ app }) => app);
}
