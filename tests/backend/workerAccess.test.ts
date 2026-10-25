import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { resolveActiveWorkerUserId } from "../../lib/api/work";
import { ApiError } from "../../lib/api/errors";

const workerId = "11111111-1111-4111-8111-111111111111";
const originalFetch = globalThis.fetch;
let profileActive = true;
let workerActive = true;
let workerExists = true;
let inserted = false;

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://worker-access.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://worker-access.example.test");
    if ((init?.method ?? "GET") !== "GET") inserted = true;
    let rows: unknown[];
    if (url.pathname === "/rest/v1/profiles") rows = [{ id: workerId, active: profileActive }];
    else if (url.pathname === "/rest/v1/workers") rows = workerExists ? [{ id: "WKR-TEST", active: workerActive }] : [];
    else throw new Error(`Unexpected request: ${url.pathname}`);
    return new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } });
  };
});

after(() => { globalThis.fetch = originalFetch; });

test("assignment targets must have both an active profile and worker record", async () => {
  assert.equal(await resolveActiveWorkerUserId("WKR-TEST"), workerId);
  assert.equal(await resolveActiveWorkerUserId(workerId), workerId);
  for (const status of [[false, true], [true, false], [false, false]]) {
    [profileActive, workerActive] = status;
    await assert.rejects(resolveActiveWorkerUserId(workerId), (error: unknown) =>
      error instanceof ApiError && error.status === 409 && error.code === "worker_inactive");
  }
  profileActive = workerActive = true;
  workerExists = false;
  await assert.rejects(resolveActiveWorkerUserId(workerId), (error: unknown) =>
    error instanceof ApiError && error.status === 404);
  assert.equal(inserted, false, "Checking worker eligibility never changes a record");
});
