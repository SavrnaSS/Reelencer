import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_WORKER_SELECTION,
  filterWorkerDirectory,
  safeWorkerCsvCell,
  updateWorkerSelection,
  workerAccessStatus,
  workerDirectoryCsv,
  currentWorkerRecords,
  type WorkerDirectoryRecord,
} from "../../lib/adminWorkerDirectory";

const worker = (id: string, overrides: Partial<WorkerDirectoryRecord> = {}): WorkerDirectoryRecord => ({
  id, name: `Creator ${id}`, email: `${id}@example.test`, active: true,
  accountCount: 0, submittedCount: 0, resubmitCount: 0, approvedINR: 0, ...overrides,
});
const defaults = { status: "current", assignment: "all", payment: "all", sort: "name_asc" } as const;

test("operational worker lists exclude deleted accounts before limiting and preserve suspended users and source records", () => {
  const deleted = Array.from({ length: 6 }, (_, index) => worker(`deleted-${index}`, { active: true, moderationStatus: "deleted" }));
  const rows = [...deleted, worker("active"), worker("suspended", { active: false, moderationStatus: "suspended" })];
  assert.deepEqual(currentWorkerRecords(rows).slice(0, 6).map(row => row.id), ["active", "suspended"]);
  assert.equal(rows.length, 8, "The restore directory retains the original records");
  assert.deepEqual(currentWorkerRecords(deleted), []);
});

test("directory access status never lets an active moderation label override disabled access", () => {
  assert.equal(workerAccessStatus(worker("active")), "active");
  assert.equal(workerAccessStatus(worker("inactive", { active: false })), "suspended");
  assert.equal(workerAccessStatus(worker("mismatch", { active: false, moderationStatus: "active" })), "suspended");
  assert.equal(workerAccessStatus(worker("suspended", { active: true, moderationStatus: "suspended" })), "suspended");
  assert.equal(workerAccessStatus(worker("deleted", { active: true, moderationStatus: "deleted" })), "deleted");
});

test("default current filter hides archived users while explicit filters remain precise", () => {
  const rows = [worker("active"), worker("suspended", { active: false }), worker("deleted", { active: false, moderationStatus: "deleted" })];
  assert.deepEqual(filterWorkerDirectory(rows, defaults).map(row => row.id), ["active", "suspended"]);
  assert.equal(filterWorkerDirectory(rows, { ...defaults, status: "all" }).length, 3);
  for (const status of ["active", "suspended", "deleted"] as const) {
    assert.deepEqual(filterWorkerDirectory(rows, { ...defaults, status }).map(row => row.id), [status]);
  }
});

test("search requires all case-insensitive terms across name, email and ID and combines independent filters", () => {
  const rows = [
    worker("WKR-101", { name: "Manish Kumar", email: "creator@example.test", accountCount: 2, upiVerified: true }),
    worker("WKR-102", { name: "Manish Singh", email: "other@example.test", upiVerified: false }),
  ];
  assert.deepEqual(filterWorkerDirectory(rows, { ...defaults, query: "  MANISH\tcreator 101  " }).map(row => row.id), ["WKR-101"]);
  assert.equal(filterWorkerDirectory(rows, { ...defaults, query: "manish missing" }).length, 0);
  assert.deepEqual(filterWorkerDirectory(rows, { ...defaults, assignment: "assigned", payment: "verified" }).map(row => row.id), ["WKR-101"]);
  assert.deepEqual(filterWorkerDirectory(rows, { ...defaults, assignment: "unassigned", payment: "unverified" }).map(row => row.id), ["WKR-102"]);
  assert.equal(filterWorkerDirectory(rows, { ...defaults, assignment: "unassigned", payment: "verified" }).length, 0);
});

test("directory sorting is deterministic on ties and never mutates the source array or records", () => {
  const rows = [
    worker("B", { name: "Creator 10", approvedINR: 50, accountCount: 2, submittedCount: 4 }),
    worker("C", { name: "creator 2", approvedINR: 50, accountCount: 2, submittedCount: 4 }),
    worker("A", { name: "Creator 2", approvedINR: 50, accountCount: 2, submittedCount: 4 }),
  ];
  const original = structuredClone(rows);
  for (const row of rows) Object.freeze(row);
  Object.freeze(rows);
  for (const sort of ["name_asc", "earnings", "accounts", "submissions", "resubmits"] as const) {
    assert.deepEqual(filterWorkerDirectory(rows, { ...defaults, sort }).map(row => row.id), ["A", "C", "B"]);
  }
  assert.deepEqual(filterWorkerDirectory(rows, { ...defaults, sort: "name_desc" }).map(row => row.id), ["B", "C", "A"]);
  assert.deepEqual(rows, original);
  const ranked = [worker("low", { name: "A", approvedINR: 5 }), worker("high", { name: "Z", approvedINR: 100 })];
  assert.deepEqual(filterWorkerDirectory(ranked, { ...defaults, sort: "earnings" }).map(row => row.id), ["high", "low"]);
});

test("visible-page selection preserves hidden selections, deduplicates IDs and leaves inputs unchanged", () => {
  const original = new Set(["on-another-page", "hidden-by-filter"]);
  const added = updateWorkerSelection(original, ["visible-1", "visible-1", "visible-2"], true);
  assert.deepEqual([...original], ["on-another-page", "hidden-by-filter"]);
  assert.deepEqual([...added.ids], ["on-another-page", "hidden-by-filter", "visible-1", "visible-2"]);
  assert.equal(added.limitReached, false);
  const removed = updateWorkerSelection(added.ids, ["visible-1", "visible-2"], false);
  assert.deepEqual([...removed.ids], [...original]);
  assert.equal(added.ids.size, 4, "Deselecting a page does not mutate the preceding selection");
});

test("bulk selection enforces the 100-user cap while preserving earlier selected IDs", () => {
  assert.equal(MAX_WORKER_SELECTION, 100);
  const firstPage = new Set(Array.from({ length: 99 }, (_, index) => `earlier-${index}`));
  const result = updateWorkerSelection(firstPage, ["earlier-0", "new-1", "new-1", "new-2"], true);
  assert.equal(result.ids.size, 100);
  assert.equal(result.limitReached, true);
  assert.equal(result.ids.has("new-1"), true);
  assert.equal(result.ids.has("new-2"), false);
  assert.equal(firstPage.size, 99);
  const unchanged = updateWorkerSelection(result.ids, [...result.ids], true);
  assert.equal(unchanged.limitReached, false, "Selecting an already-selected page does not report overflow");
  const emptied = updateWorkerSelection(result.ids, [...result.ids], false);
  assert.equal(emptied.ids.size, 0);
});

test("CSV cells neutralize formulas and quote commas, quotes, line breaks and empty values", () => {
  for (const value of ["=HYPERLINK(\"bad\")", "+SUM(1,2)", "-1+2", "@SUM(A1)", "  =1", "\uFEFF=1", "\u0001=1+1", "\tplain", "\rplain", "\nplain"]) {
    assert.equal(safeWorkerCsvCell(value).startsWith('"\''), true, `Unsafe spreadsheet prefix ${JSON.stringify(value)}`);
  }
  assert.equal(safeWorkerCsvCell('Name, "quoted"\nsecond line'), '"Name, ""quoted""\nsecond line"');
  assert.equal(safeWorkerCsvCell("safe\u0000text"), '"safetext"');
  assert.equal(safeWorkerCsvCell(null), '""');
  assert.equal(safeWorkerCsvCell(250.5), '"250.5"');
  assert.equal(safeWorkerCsvCell("name@example.test"), '"name@example.test"');
});

test("directory CSV has a UTF-8 BOM, consistent line endings and safe exported statuses and amounts", () => {
  const csv = workerDirectoryCsv([
    worker("WKR-1", { name: '=HYPERLINK("bad")', email: "line1,\"quoted\"\nline2@example.test", active: false, moderationStatus: "active", approvedINR: 45.5, upiVerified: true }),
    worker("WKR-2", { moderationStatus: "deleted", approvedINR: Number.POSITIVE_INFINITY }),
  ]);
  assert.equal(csv.startsWith("\uFEFF\"Worker ID\""), true);
  assert.equal(csv.endsWith("\r\n"), true);
  assert.match(csv, /"'\=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"line1,""quoted""\nline2@example\.test"/);
  assert.match(csv, /"suspended","0","0","0","45\.50","Verified"/);
  assert.match(csv, /"deleted","0","0","0","0\.00","Unverified"/);
});
