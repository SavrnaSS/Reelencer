import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { getAdminWorkersResult } from "../../app/api/admin/_workers";

const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const code = (n: number) => `WKR-${String(n).padStart(5, "0")}`;
type Options = { count?: number; tableRowCap?: number; failTable?: string; failOffset?: number; missingTimezone?: boolean; moderationCount?: number; authCount?: number; repeatAuthPage?: boolean };
function fakeDirectory(options: Options = {}) {
  const count = options.count ?? 2;
  const tables: Record<string, Record<string, unknown>[]> = {
    workers: Array.from({ length: count }, (_, i) => ({ id: code(i + 1), user_id: uuid(i + 1), name: `Creator ${i + 1}`, email: `creator${i + 1}@example.test`, active: i !== 1002, timezone: "Asia/Kolkata" })),
    profiles: Array.from({ length: count }, (_, i) => ({ id: uuid(i + 1), worker_code: code(i + 1), role: "Worker", display_name: `Creator ${i + 1}`, email: `creator${i + 1}@example.test`, active: i !== 1002, timezone: "Asia/Kolkata", created_at: "2026-01-01T00:00:00Z" })),
    worker_moderation: Array.from({ length: options.moderationCount ?? count }, (_, i) => ({ user_id: uuid(i + 1), status: i === 1002 ? "deleted" : "active" })),
  };
  const authUsers = Array.from({ length: options.authCount ?? count }, (_, i) => ({ id: uuid(i + 1), email: `creator${i + 1}@example.test`, email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" }));
  const calls: { table: string; offset: number; limit: number; select: string; order: string }[] = [];
  const client = createClient("https://worker-records.example.test", "test-service-key", {
    auth: { persistSession: false, autoRefreshToken: false }, db: { retry: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, "https://worker-records.example.test");
      assert.equal(init?.method ?? "GET", "GET", "Directory reads must never mutate Auth, Storage or the database");
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
      if (url.pathname === "/auth/v1/admin/users") {
        const page = Number(url.searchParams.get("page") ?? "1");
        const perPage = Number(url.searchParams.get("per_page") ?? "200");
        const offset = options.repeatAuthPage ? 0 : (page - 1) * perPage;
        calls.push({ table: "auth", offset, limit: perPage, select: "", order: "" });
        // No total/link headers: the loader must not assume the first 200 users are complete.
        return json({ users: authUsers.slice(offset, offset + perPage), aud: "authenticated" });
      }
      const table = url.pathname.slice("/rest/v1/".length);
      assert.ok(table in tables, `Unexpected directory request: ${url.pathname}`);
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "1000");
      const select = url.searchParams.get("select") ?? "";
      const order = url.searchParams.get("order") ?? "";
      calls.push({ table, offset, limit, select, order });
      if (options.failTable === table && offset >= (options.failOffset ?? 0)) return json({ message: "Test data source unavailable", code: "08006" }, 503);
      if (options.missingTimezone && select.includes("timezone")) return json({ message: "column timezone does not exist", code: "42703" }, 400);
      return json(tables[table].slice(offset, offset + Math.min(limit, options.tableRowCap ?? 1000)));
    } },
  });
  return { client, calls };
}

test("directory pages every identity and moderation source beyond 1,000 rows with stable ordering", async () => {
  const { client, calls } = fakeDirectory({ count: 1005 });
  const result = await getAdminWorkersResult(client);
  assert.equal(result.error, undefined);
  assert.equal(result.workers.length, 1005);
  const archived = result.workers.find(worker => worker.id === code(1003));
  assert.equal(archived?.userId, uuid(1003));
  assert.equal(archived?.active, false);
  assert.equal(archived?.moderationStatus, "deleted", "Restrictions after the first PostgREST page must not disappear");
  for (const table of ["workers", "profiles", "worker_moderation"]) {
    assert.deepEqual(calls.filter(call => call.table === table).map(call => call.offset), [0, 1000, 1005]);
    assert.ok(calls.filter(call => call.table === table).every(call => call.limit <= 1000));
  }
  assert.ok(calls.filter(call => call.table === "profiles").every(call => call.order === "created_at.desc,id.asc"));
  assert.ok(calls.filter(call => call.table === "workers").every(call => call.order === "id.asc"));
  assert.ok(calls.filter(call => call.table === "worker_moderation").every(call => call.order === "user_id.asc"));
  assert.equal(calls.filter(call => call.table === "auth").length, 6);
});

test("directory keeps paging when a project caps responses below the requested page size", async () => {
  const { client, calls } = fakeDirectory({ count: 251, tableRowCap: 100 });
  const result = await getAdminWorkersResult(client);
  assert.equal(result.error, undefined);
  assert.equal(result.workers.length, 251);
  assert.deepEqual(calls.filter(call => call.table === "worker_moderation").map(call => call.offset), [0, 100, 200, 251]);
});

test("compatibility column fallbacks are retained and reused for later pages", async () => {
  const { client, calls } = fakeDirectory({ count: 1005, missingTimezone: true });
  const result = await getAdminWorkersResult(client);
  assert.equal(result.error, undefined);
  assert.equal(result.workers.length, 1005);
  for (const table of ["workers", "profiles"]) {
    assert.ok(calls.filter(call => call.table === table && call.offset > 0).every(call => !call.select.includes("timezone")));
  }
  assert.equal(result.workers.find(worker => worker.id === code(1003))?.active, false);
});

test("any incomplete identity or moderation read fails closed instead of guessing users are active", async () => {
  for (const failTable of ["workers", "profiles", "worker_moderation"]) {
    const { client } = fakeDirectory({ count: 1005, failTable, failOffset: 1000 });
    const result = await getAdminWorkersResult(client);
    assert.deepEqual(result.workers, [], `${failTable} failure must not produce a partially trusted user list`);
    assert.ok(result.error);
  }
});

test("directories above either the Auth or moderation safety cap fail closed", async () => {
  for (const options of [{ count: 1, authCount: 10_001 }, { count: 1, moderationCount: 10_001 }]) {
    const { client } = fakeDirectory(options);
    const result = await getAdminWorkersResult(client);
    assert.deepEqual(result.workers, []);
    assert.ok(result.error);
  }
});

test("an exact 10,000-row boundary is proven complete and repeated Auth pages are rejected", async () => {
  const exact = fakeDirectory({ count: 1, moderationCount: 10_000 });
  const result = await getAdminWorkersResult(exact.client);
  assert.equal(result.error, undefined);
  assert.equal(result.workers.length, 1);
  const finalPage = exact.calls.filter(call => call.table === "worker_moderation").at(-1);
  assert.equal(finalPage?.offset, 10_000);
  assert.equal(finalPage?.limit, 1);
  const repeated = fakeDirectory({ count: 201, repeatAuthPage: true });
  const rejected = await getAdminWorkersResult(repeated.client);
  assert.deepEqual(rejected.workers, []);
  assert.ok(rejected.error);
});
