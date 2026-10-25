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
