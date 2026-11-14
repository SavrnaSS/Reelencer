import test from "node:test";
import assert from "node:assert/strict";
import {
  applicationQueueSubmission,
  countApplicationQueueFilters,
  hasApplicationAccount,
  matchesApplicationQueueFilter,
  sortApplicationQueue,
  type ApplicationQueueFilter,
  type ApplicationQueueSort,
} from "../../lib/adminApplicationQueue";

type Application = {
  id: string;
  gigId: string;
  workerId: string;
  workerName?: string;
  status?: string;
  appliedAt: string;
  proposal?: { submittedAt?: string; reviewedAt?: string; accountSetup?: { handle?: string; submittedAt?: string; checkedAt?: string; reviewedAt?: string; revision?: number; status?: string } };
};
const application = (id: string, appliedAt: string, submittedAt?: string): Application => ({
  id, gigId: "gig-1", workerId: `worker-${id}`, appliedAt, status: "Pending",
  proposal: submittedAt ? { accountSetup: { handle: `creator_${id}`, submittedAt, status: "Submitted", revision: 1 } } : undefined,
});
const ids = (apps: readonly Application[], sort: ApplicationQueueSort = "latest") => sortApplicationQueue(apps, sort).map(app => app.id);
const filteredIds = (apps: readonly Application[], filter: ApplicationQueueFilter) => apps.filter(app => matchesApplicationQueueFilter(app, filter)).map(app => app.id);

test("Latest uses account submission time and includes applications without accounts in the same timeline", () => {
  const apps = [
    application("new-form", "2026-11-14T11:00:00Z"),
    application("older-account", "2026-11-14T10:00:00Z", "2026-11-14T10:30:00Z"),
    application("new-account", "2026-11-01T08:00:00Z", "2026-11-14T10:55:00Z"),
    application("old-form", "2026-11-13T09:00:00Z"),
  ];
  assert.deepEqual(ids(apps), ["new-form", "new-account", "older-account", "old-form"]);
  assert.deepEqual(ids(apps, "oldest"), ["old-form", "older-account", "new-account", "new-form"]);
  assert.deepEqual(apps.map(app => app.id), ["new-form", "older-account", "new-account", "old-form"], "sorting must not mutate the fetched applications");
});

test("a refreshed account resubmission moves up while checks and recruiter edits leave its place unchanged", () => {
  const apps = [
    application("waiting", "2026-11-01T08:00:00Z", "2026-11-14T09:00:00Z"),
    application("recent", "2026-11-13T08:00:00Z", "2026-11-14T10:00:00Z"),
  ];
  assert.deepEqual(ids(apps), ["recent", "waiting"]);
  const reviewed: Application = {
    ...apps[0],
    proposal: {
      submittedAt: "2026-11-14T11:00:00Z", reviewedAt: "2026-11-14T11:01:00Z",
      accountSetup: { ...apps[0].proposal!.accountSetup, checkedAt: "2026-11-14T11:02:00Z", reviewedAt: "2026-11-14T11:03:00Z", status: "ChangesRequested" },
    },
  };
  assert.deepEqual(ids([reviewed, apps[1]]), ["recent", "waiting"]);
  const resubmitted: Application = {
    ...reviewed,
    proposal: { ...reviewed.proposal, accountSetup: { ...reviewed.proposal!.accountSetup, submittedAt: "2026-11-14T11:04:00Z", revision: 2, status: "Submitted" } },
  };
  assert.deepEqual(ids([resubmitted, apps[1]]), ["waiting", "recent"]);
  assert.deepEqual(applicationQueueSubmission(resubmitted), { at: "2026-11-14T11:04:00Z", source: "account" });
});

test("missing and invalid legacy account times fall back to the application time, with undated rows last", () => {
  for (const submittedAt of [undefined, "", "not-a-date", "1970-01-01T00:00:00.000Z"]) {
    const legacy: Application = { ...application("legacy", "2026-11-14T10:00:00Z"), proposal: { accountSetup: { handle: "legacy_creator", submittedAt } } };
    assert.deepEqual(applicationQueueSubmission(legacy), { at: legacy.appliedAt, source: "application" });
    const apps = [legacy, application("undated", "invalid"), application("older", "2026-11-13T10:00:00Z")];
    assert.deepEqual(ids(apps), ["legacy", "older", "undated"]);
    assert.deepEqual(ids(apps, "oldest"), ["older", "legacy", "undated"]);
  }
});

test("equal submission times have a deterministic order across refreshes and timezone offsets", () => {
  const apps = [
    application("b", "2026-11-14T08:00:00Z", "2026-11-14T15:30:00+05:30"),
    application("a", "2026-11-01T08:00:00Z", "2026-11-14T10:00:00Z"),
  ];
  for (const sort of ["latest", "oldest"] as const) {
    assert.deepEqual(ids(apps, sort), ["a", "b"]);
    assert.deepEqual(ids([...apps].reverse(), sort), ["a", "b"]);
  }
});

test("Worker A–Z and Gig A–Z keep their selected primary order", () => {
  const apps = [
    { ...application("account", "2026-11-01T08:00:00Z", "2026-11-14T11:00:00Z"), gigId: "gig-1", workerName: "Zoya" },
    { ...application("form", "2026-11-14T10:00:00Z"), gigId: "gig-2", workerName: "Asha" },
  ];
  assert.deepEqual(ids(apps, "worker_asc"), ["form", "account"]);
  assert.deepEqual(sortApplicationQueue(apps, "gig_asc", id => ({ "gig-1": "Reel Posting", "gig-2": "Indoor Video" })[id]).map(app => app.id), ["form", "account"]);
  assert.deepEqual(ids(apps, "gig_asc"), ["account", "form"], "unknown gigs fall back to their IDs");
});

const mixedApplications = (): Application[] => [
  application("pending-account", "2026-11-01T08:00:00Z", "2026-11-14T10:55:00Z"),
  { ...application("legacy-form", "2026-11-14T11:00:00Z"), status: "Applied" },
  { ...application("accepted-account", "2026-11-01T08:00:00Z", "2026-11-14T10:50:00Z"), status: "Accepted" },
  { ...application("rejected-account", "2026-11-01T08:00:00Z", "2026-11-14T10:45:00Z"), status: "Rejected" },
  { ...application("withdrawn-form", "2026-11-14T10:40:00Z"), status: "Withdrawn" },
  application("pending-form", "2026-11-14T10:35:00Z"),
  { ...application("legacy-account", "2026-11-14T10:30:00Z"), proposal: { accountSetup: { handle: "legacy_creator", submittedAt: "1970-01-01T00:00:00.000Z", status: "Verified" } } },
];

test("All includes every application regardless of account presence or review status", () => {
  const apps = mixedApplications();
  assert.deepEqual(filteredIds(apps, "All"), apps.map(app => app.id));
  assert.deepEqual(ids(apps.filter(app => matchesApplicationQueueFilter(app, "All"))), [
    "legacy-form", "pending-account", "accepted-account", "rejected-account", "withdrawn-form", "pending-form", "legacy-account",
  ]);
});

test("Account sent and Without account partition all applications independently of review status", () => {
  const apps = mixedApplications();
  assert.deepEqual(filteredIds(apps, "Account sent"), ["pending-account", "accepted-account", "rejected-account", "legacy-account"]);
  assert.deepEqual(filteredIds(apps, "Without account"), ["legacy-form", "withdrawn-form", "pending-form"]);
  const counts = countApplicationQueueFilters(apps);
  assert.deepEqual(counts, { All: 7, "Account sent": 4, "Without account": 3, Pending: 4, Accepted: 1, Rejected: 1, Withdrawn: 1 });
  assert.equal(counts["Account sent"] + counts["Without account"], counts.All);
});

test("Pending includes legacy Applied applications so the Awaiting counter and queue agree", () => {
  const apps = mixedApplications();
  assert.deepEqual(filteredIds(apps, "Pending"), ["pending-account", "legacy-form", "pending-form", "legacy-account"]);
  for (const filter of ["Pending", "Accepted", "Rejected", "Withdrawn"] as const) {
    assert.equal(countApplicationQueueFilters(apps)[filter], filteredIds(apps, filter).length);
  }
});

test("filter counts move from Without account to Account sent after a live submission without losing the application", () => {
  const before = [application("new", "2026-11-14T10:30:00Z")];
  assert.deepEqual(countApplicationQueueFilters(before), { All: 1, "Account sent": 0, "Without account": 1, Pending: 1, Accepted: 0, Rejected: 0, Withdrawn: 0 });
  const refreshed = [application("new", before[0].appliedAt, "2026-11-14T11:00:00Z")];
  assert.deepEqual(countApplicationQueueFilters(refreshed), { All: 1, "Account sent": 1, "Without account": 0, Pending: 1, Accepted: 0, Rejected: 0, Withdrawn: 0 });
  assert.deepEqual(filteredIds(refreshed, "All"), ["new"]);
  assert.deepEqual(countApplicationQueueFilters([]), { All: 0, "Account sent": 0, "Without account": 0, Pending: 0, Accepted: 0, Rejected: 0, Withdrawn: 0 });
});

test("account presence uses submitted details even when legacy timestamps are missing", () => {
  const app = application("legacy", "2026-11-14T10:30:00Z");
  for (const submittedAt of [undefined, "", "invalid", "1970-01-01T00:00:00.000Z"]) {
    const legacy = { ...app, proposal: { accountSetup: { handle: "legacy_creator", submittedAt } } };
    assert.equal(hasApplicationAccount(legacy), true);
    assert.equal(matchesApplicationQueueFilter(legacy, "Account sent"), true);
  }
  for (const accountSetup of [undefined, {}, { handle: "   " }, { submittedAt: "2026-11-14T11:00:00Z" }]) {
    assert.equal(hasApplicationAccount({ ...app, proposal: { accountSetup } }), false);
  }
});
