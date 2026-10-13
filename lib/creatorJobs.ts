export type CreatorJobGroup = "review" | "active" | "submitted" | "done" | "closed";

export const CREATOR_JOB_GROUPS: readonly CreatorJobGroup[] = ["review", "active", "submitted", "done", "closed"];
export const CREATOR_JOB_LABELS: Record<CreatorJobGroup, string> = {
  review: "In review", active: "Active", submitted: "Submitted", done: "Completed", closed: "Closed",
};
export const CREATOR_JOB_STEPS = ["Applied", "In review", "Accepted", "Submitted", "Approved", "Paid"] as const;

export type CreatorJobApplication = {
  id: string;
  gigId: string;
  status: string;
  appliedAt: string;
  decidedAt?: string;
  updatedAt?: string;
};

export type CreatorJobAssignment = {
  id?: string;
  gigKey: string;
  statusLabel: string;
  primaryDate?: string;
  createdAt?: string;
  submittedAt?: string;
  decidedAt?: string;
  updatedAt?: string;
};

export type CreatorJob<Gig> = {
  key: string;
  gigId: string;
  gig: Gig | null;
  status: string;
  group: CreatorJobGroup;
  stage: number;
  date?: string;
  startedAt?: string;
  application?: CreatorJobApplication;
  assignment?: CreatorJobAssignment;
};

function time(value?: string) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function dated(values: Array<string | undefined>, newest: boolean) {
  return values.filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort((a, b) => newest ? time(b) - time(a) : time(a) - time(b))[0];
}

function applicationDate(application: CreatorJobApplication) {
  return dated([application.appliedAt, application.decidedAt, application.updatedAt], true);
}

function assignmentDate(assignment: CreatorJobAssignment) {
  return dated([assignment.primaryDate, assignment.createdAt, assignment.submittedAt, assignment.decidedAt, assignment.updatedAt], true);
}

function statusOf(raw: string, assignment: boolean): { status: string; group: CreatorJobGroup; stage: number } {
  const status = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (status === "paid") return { status: "Paid", group: "done", stage: 5 };
  // Assignment Accepted records the proof-review approval.
  if (status === "approved" || (assignment && status === "accepted")) return { status: "Approved", group: "done", stage: 4 };
  if (status === "completed") return { status: "Completed", group: "done", stage: 4 };
  if (status === "submitted" || (assignment && ["pending", "in review"].includes(status)))
    return { status: status === "submitted" ? "Submitted" : "In review", group: "submitted", stage: 3 };
  if (status === "accepted" || status === "assigned") return { status: status === "assigned" ? "Assigned" : "Accepted", group: "active", stage: 2 };
  if (["rejected", "not selected", "withdrawn", "cancelled", "canceled", "closed"].includes(status)) {
    const label = status === "rejected" ? assignment ? "Rejected" : "Not selected" : status === "canceled" ? "Cancelled" : status.replace(/\b\w/g, char => char.toUpperCase());
    return { status: label, group: "closed", stage: assignment ? 3 : 1 };
  }
  return { status: status === "applied" ? "Applied" : "In review", group: "review", stage: status === "applied" ? 0 : 1 };
}

/** One creator job per gig. The work record advances the application's existing journey. */
export function buildCreatorJobs<Gig>(
  applications: readonly CreatorJobApplication[],
  assignments: readonly CreatorJobAssignment[],
  gigs: ReadonlyMap<string, Gig>,
): CreatorJob<Gig>[] {
  const records = new Map<string, { gigId: string; application?: CreatorJobApplication; assignment?: CreatorJobAssignment }>();
  applications.forEach((application, index) => {
    const gigId = String(application.gigId ?? "").trim();
    const key = gigId ? `gig:${gigId}` : `application:${application.id || index}`;
    const record = records.get(key) ?? { gigId };
    if (!record.application || time(applicationDate(application)) > time(applicationDate(record.application)) ||
      (time(applicationDate(application)) === time(applicationDate(record.application)) && application.id > record.application.id)) record.application = application;
    records.set(key, record);
  });
  assignments.forEach((assignment, index) => {
    const gigId = String(assignment.gigKey ?? "").trim();
    const key = gigId ? `gig:${gigId}` : `assignment:${assignment.id || index}`;
    const record = records.get(key) ?? { gigId };
    if (!record.assignment || time(assignmentDate(assignment)) > time(assignmentDate(record.assignment)) ||
      (time(assignmentDate(assignment)) === time(assignmentDate(record.assignment)) && String(assignment.id ?? "") > String(record.assignment.id ?? ""))) record.assignment = assignment;
    records.set(key, record);
  });

  return [...records].map(([key, { gigId, application, assignment }]) => {
    const state = statusOf(assignment?.statusLabel ?? application?.status ?? "", Boolean(assignment));
    const date = dated([application && applicationDate(application), assignment && assignmentDate(assignment)], true);
    const startedAt = dated([application?.appliedAt, assignment?.createdAt], false) ?? date;
    return { key, gigId, gig: gigs.get(gigId) ?? null, ...state, date, startedAt, application, assignment };
  }).sort((a, b) => time(b.date) - time(a.date) || a.key.localeCompare(b.key));
}

export function creatorJobCounts(jobs: readonly { group: CreatorJobGroup }[]) {
  const counts: Record<"all" | CreatorJobGroup, number> = { all: jobs.length, review: 0, active: 0, submitted: 0, done: 0, closed: 0 };
  jobs.forEach(job => { counts[job.group] += 1; });
  return counts;
}
