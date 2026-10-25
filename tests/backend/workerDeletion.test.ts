import test from "node:test";
import assert from "node:assert/strict";
import { workerPurgeAfter, workerDeletionLabel, WORKER_DELETION_RETENTION_MS } from "../../lib/workerDeletion";

test("worker deletion deadlines use seven complete days independently of display time zones", () => {
  assert.equal(workerPurgeAfter("2026-10-22T05:38:44.914Z"), "2026-10-29T05:38:44.914Z");
  assert.equal(workerPurgeAfter("2026-10-25T09:36:00+05:30"), "2026-11-01T04:06:00.000Z");
  assert.equal(workerPurgeAfter("invalid"), undefined);
  assert.equal(WORKER_DELETION_RETENTION_MS, 604800000);
});

test("directory labels distinguish the restore window, due work and permanent removal", () => {
  const now = Date.parse("2026-10-25T00:00:00Z");
  assert.match(workerDeletionLabel("2026-10-29T00:00:00Z", null, now), /4 days/);
  assert.match(workerDeletionLabel("2026-10-25T00:30:00Z", null, now), /1 hour$/);
  assert.equal(workerDeletionLabel("2026-10-24T00:00:00Z", null, now), "Waiting for permanent deletion");
  assert.equal(workerDeletionLabel("2026-10-24T00:00:00Z", "2026-10-25T00:00:00Z", now), "Permanent deletion in progress");
});
