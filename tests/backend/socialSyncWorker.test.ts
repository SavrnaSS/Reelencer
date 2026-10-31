import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../../cloudflare/email-worker";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const env = { GIG_INGEST_URL: "https://example.test/api/gig-inbox/ingest", GIG_INGEST_SECRET: "i".repeat(32), SOCIAL_SYNC_URL: "https://example.test/api/jobs/social-sync", CRON_SECRET: "c".repeat(32) };

test("the minute worker calls the authenticated job without putting its secret in the URL", async () => {
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests++;
    assert.equal(String(input), env.SOCIAL_SYNC_URL);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${env.CRON_SECRET}`);
    return new Response('{}');
  };
  await worker.scheduled({}, env);
  assert.equal(requests, 1);
});

test("misconfigured scheduler destinations and missing authentication never send a request", async () => {
  globalThis.fetch = async () => { throw new Error("No network calls expected"); };
  for (const SOCIAL_SYNC_URL of ["http://example.test/api/jobs/social-sync", "https://user:password@example.test/api/jobs/social-sync", "https://example.test/wrong", "https://example.test/api/jobs/social-sync?token=secret"]) {
    await assert.rejects(worker.scheduled({}, { ...env, SOCIAL_SYNC_URL }), /HTTPS social sync job URL/);
  }
  await assert.rejects(worker.scheduled({}, { ...env, CRON_SECRET: "" }), /CRON_SECRET/);
});

test("worker erasure and social sync run independently and both requests finish when one fails", async () => {
  const paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${env.CRON_SECRET}`);
    return new Response('{}', { status: path.endsWith('social-sync') ? 503 : 200 });
  };
  await assert.rejects(worker.scheduled({}, { ...env, WORKER_PURGE_URL: "https://example.test/api/jobs/worker-purge" }), /job failed/);
  assert.deepEqual(paths.sort(), ['/api/jobs/social-sync','/api/jobs/worker-purge']);
});

test("monthly auto-withdrawals are triggered once an hour, at minute five", async () => {
  const paths: string[] = [];
  globalThis.fetch = async (input) => { paths.push(new URL(String(input)).pathname); return new Response('{}'); };
  const withAuto = { ...env, AUTO_WITHDRAWAL_URL: "https://example.test/api/jobs/auto-withdrawals" };
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 10, 1, 3, 4) }, withAuto);
  assert.deepEqual(paths, ['/api/jobs/social-sync']);
  paths.length = 0;
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 10, 1, 3, 5) }, withAuto);
  assert.deepEqual(paths.sort(), ['/api/jobs/auto-withdrawals', '/api/jobs/social-sync']);
  paths.length = 0;
  await assert.rejects(worker.scheduled({ scheduledTime: Date.UTC(2026, 10, 1, 3, 5) }, { ...withAuto, AUTO_WITHDRAWAL_URL: "https://example.test/api/jobs/auto-withdrawals?x=1" }), /HTTPS auto-withdrawal job URL/);
  assert.deepEqual(paths, ['/api/jobs/social-sync'], "a misconfigured job URL is never called");
});
