import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { AccountOwnershipCooldownError, accountVerifyCode, checkAccountOwnership, previewAccountOwnership } from "../../lib/api/accountSetup";
import { encodeWorkerName } from "../../lib/api/gigApplications";
import type { StoredAccountSetup } from "../../lib/accountSetup";
import { GET, POST } from "../../app/api/gig-applications/account-setup/route";

const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
const actor = { userId: "11111111-1111-4111-8111-111111111111", aliases: ["QA-CREATOR"] };
let sequence = 0, applicationId: string, profileReads: number;
let mode: "found" | "missing_code" | "wrong_profile" | "limited" | "login" | "missing" | "hold";
let release: (() => void) | undefined, started: (() => void) | undefined;
let submitted: StoredAccountSetup | undefined, proposalWrites: number;
const json = (value: unknown) => Response.json(value);

beforeEach(() => {
  applicationId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12, "0")}`;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ownership-preview.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.WORK_EMAIL_CRYPTO_SECRET = "test-only-ownership-secret-with-at-least-32-characters";
  process.env.META_GRAPH_ACCESS_TOKEN = "";
  process.env.META_IG_BUSINESS_ACCOUNT_ID = "";
  process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE = "false";
  mode = "found"; profileReads = 0; release = undefined; started = undefined;
  submitted = undefined; proposalWrites = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.ok(!init?.method || init.method === "GET" || (submitted && url.pathname === "/rest/v1/rpc/update_gig_application"), "only explicitly mocked submitted-check writes are allowed");
    if (url.origin === "https://www.instagram.com") {
      profileReads++; started?.();
      if (mode === "hold") await new Promise<void>(resolve => { release = resolve; });
      if (mode === "limited") return new Response("Limited", { status: 429, headers: { "Retry-After": "120" } });
      if (mode === "login") return new Response("Login", { status: 302 });
      if (mode === "missing") return new Response("Missing", { status: 404 });
      const code = accountVerifyCode(applicationId);
      const biography = mode === "missing_code" ? "Creator bio without verification" : `Creator\n${code}`;
      const username = mode === "wrong_profile" ? "another_creator" : url.pathname.split("/")[1];
      return new Response(`<div>${code}</div><script type="application/json">${JSON.stringify({ user: { username, biography } })}</script>`, { headers: { "Content-Type": "text/html" } });
    }
    assert.equal(url.origin, "https://ownership-preview.example.test", "never contact a live service");
    if (url.pathname === "/auth/v1/user") return json({ id: actor.userId, email: "qa@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false });
    if (url.pathname === "/rest/v1/profiles") return json([{ worker_code: "QA-CREATOR", active: true }]);
    if (url.pathname === "/rest/v1/workers") return json([{ id: "QA-CREATOR", active: true }]);
    if (url.pathname === "/rest/v1/gig_applications") return json({ id: applicationId, gig_id: "qa-gig", worker_code: "QA-CREATOR", worker_name: submitted ? encodeWorkerName("QA Creator", { accountSetup: submitted }) : "QA Creator", status: "In review" });
    if (url.pathname === "/rest/v1/rpc/update_gig_application") {
      proposalWrites++;
      const body = JSON.parse(String(init?.body));
      const result = { ...body.p_expected, worker_name: body.p_name };
      const { decodeWorkerName } = await import("../../lib/api/gigApplications");
      submitted = decodeWorkerName(body.p_name).proposal?.accountSetup;
      return json(result);
    }
    if (url.pathname === "/rest/v1/gigs") return json({ id: "qa-gig", title: "Creator campaign", company: "QA", platform: "Instagram", gig_type: "Content Posting" });
    if (url.pathname === "/rest/v1/integration_settings") return json([]);
    throw new Error(`Unexpected preview test request: ${url.pathname}`);
  };
});

test("submitted checks persist provider cooldowns and return their remaining retry time", async () => {
  submitted = { platform: "Instagram", handle: "creator.submitted", profileUrl: "https://www.instagram.com/creator.submitted/", email: "", status: "Submitted", revision: 1, submittedAt: new Date(Date.now() - 180_000).toISOString(), checkedAt: new Date(Date.now() - 180_000).toISOString(), ownership: "missing" };
  mode = "limited";
  const result = await checkAccountOwnership({ ...actor, isAdmin: false }, applicationId);
  const retryAt = result.proposal?.accountSetup?.ownershipRetryAt;
  assert.ok(retryAt && Date.parse(retryAt) >= Date.now() + 119_000);
  assert.equal(result.proposal?.accountSetup?.ownership, "unreadable");
  assert.equal(profileReads, 1); assert.equal(proposalWrites, 1);
  await assert.rejects(checkAccountOwnership({ ...actor, isAdmin: false }, applicationId), error => error instanceof AccountOwnershipCooldownError && error.retryAfterSeconds >= 119);
  const response = await POST(new NextRequest("https://app.example.test/api/gig-applications/account-setup", { method: "POST", headers: { authorization: "Bearer test-session", "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", applicationId }) }), { params: Promise.resolve({}) });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("Retry-After")) >= 119);
  assert.ok((await response.json()).retryAfterSeconds >= 119);
  assert.equal(profileReads, 1); assert.equal(proposalWrites, 1, "cooldown checks never write or send notifications");
});

test("readable submitted biographies clear an expired provider pause", async () => {
  submitted = { platform: "Instagram", handle: "creator.recovered", profileUrl: "https://www.instagram.com/creator.recovered/", email: "", status: "Submitted", revision: 1, submittedAt: new Date(Date.now() - 180_000).toISOString(), checkedAt: new Date(Date.now() - 180_000).toISOString(), ownership: "unreadable", ownershipRetryAt: new Date(Date.now() - 1_000).toISOString() };
  mode = "missing_code";
  const result = await checkAccountOwnership({ ...actor, isAdmin: false }, applicationId);
  assert.equal(result.proposal?.accountSetup?.ownership, "missing");
  assert.equal(result.proposal?.accountSetup?.ownershipRetryAt, undefined);
  assert.equal(profileReads, 1); assert.equal(proposalWrites, 1);
});
afterEach(() => { release?.(); globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });

test("bio-only ownership previews detect the expected code without requiring follower statistics", async () => {
  const preview = await previewAccountOwnership(actor, applicationId, "creator.bio");
  assert.equal(preview.state, "found");
  if (preview.state === "found") { assert.equal(preview.codeFound, true); assert.equal(preview.followers, undefined); }
  assert.ok(preview.checkedAt && Number.isFinite(Date.parse(preview.checkedAt)));
  assert.equal(profileReads, 1);
});

test("code echoes outside the requested biography cannot verify a creator", async () => {
  mode = "missing_code";
  const missing = await previewAccountOwnership(actor, applicationId, "creator.missingcode");
  assert.equal(missing.state, "found");
  if (missing.state === "found") assert.equal(missing.codeFound, false);
  mode = "wrong_profile";
  const wrong = await previewAccountOwnership(actor, applicationId, "creator.wrongprofile");
  assert.equal(wrong.state, "unreadable");
});

test("concurrent previews share a provider read and cached evidence keeps its original timestamp", async () => {
  mode = "hold";
  const didStart = new Promise<void>(resolve => { started = resolve; });
  const previews = Array.from({ length: 6 }, () => previewAccountOwnership(actor, applicationId, "creator.concurrent"));
  await didStart; release?.();
  const values = await Promise.all(previews);
  assert.equal(profileReads, 1);
  assert.ok(values.every(value => value.state === "found" && value.codeFound));
  assert.ok(values.every(value => value.checkedAt === values[0].checkedAt));
  const cached = await previewAccountOwnership(actor, applicationId, "creator.concurrent");
  assert.equal(cached.checkedAt, values[0].checkedAt);
  assert.equal(profileReads, 1);
});

test("provider rate limits survive the API response and cached retries do not hit Instagram again", async () => {
  mode = "limited";
  const req = new NextRequest(`https://app.example.test/api/gig-applications/account-setup?applicationId=${applicationId}&handle=creator.limited`, { headers: { authorization: "Bearer test-session" } });
  const response = await GET(req, { params: Promise.resolve({}) });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.state, "unreadable");
  assert.equal(preview.reason, "rate_limited");
  assert.equal(preview.retryAfterSeconds, 120);
  assert.equal(response.headers.get("Retry-After"), "120");
  const cached = await previewAccountOwnership(actor, applicationId, "creator.limited");
  assert.equal(cached.checkedAt, preview.checkedAt);
  assert.ok(cached.retryAfterSeconds! > 0 && cached.retryAfterSeconds! <= 120);
  assert.equal(profileReads, 1);
});

test("login restrictions stay unreadable while a confirmed missing profile is separate", async () => {
  mode = "login";
  const blocked = await previewAccountOwnership(actor, applicationId, "creator.login");
  assert.equal(blocked.state, "unreadable");
  assert.equal(blocked.reason, "access_limited");
  assert.ok(blocked.retryAfterSeconds! >= 60);
  mode = "missing";
  assert.equal((await previewAccountOwnership(actor, applicationId, "creator.absent")).state, "not_found");
});

test("another creator cannot use an application's preview cache or trigger a provider read", async () => {
  await assert.rejects(previewAccountOwnership({ ...actor, aliases: ["ANOTHER-CREATOR"] }, applicationId, "creator.foreign"), /Application not found/);
  assert.equal(profileReads, 0);
});
