import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { readAuthEmailLink } from "../../lib/authEmailLinks";
import { remindExistingAccount } from "../../lib/api/authEmails";
import { POST as signup } from "../../app/api/auth/signup/route";
import { POST as resend } from "../../app/api/auth/resend/route";

const savedFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const userId = "11111111-1111-4111-8111-111111111111";
const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
const mails: Array<{ to: string[]; subject: string; html: string; text: string }> = [];
let confirmed = true;
let unknown = false;
let outage: "recovery" | "magiclink" | null = null;
let token = "";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const request = (path: string, body: unknown) => new NextRequest(`https://request.example.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({}) };

before(() => {
  process.env = { ...savedEnv, NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://app.example.test", NEXT_PUBLIC_SUPABASE_URL: "https://auth-email.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-service", MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test", MAIL_FROM: "Reelencer <hello@reelencer.com>" };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url.origin === "https://api.resend.com") {
      assert.equal(url.pathname, "/emails");
      mails.push(body as unknown as typeof mails[number]);
      return json({ id: "test-message" });
    }
    assert.equal(url.origin, "https://auth-email.example.test", "Tests never contact real services");
    requests.push({ path: url.pathname, body });
    if (url.pathname === "/rest/v1/email_suppressions" || url.pathname === "/rest/v1/worker_ip_blocks") return json([]);
    if (url.pathname === "/rest/v1/rpc/consume_api_rate_limit") return json(true);
    assert.equal(url.pathname, "/auth/v1/admin/generate_link");
    if (body.type === "signup") return json({ msg: "User already registered", code: "email_exists" }, 422);
    if (body.type === outage) return json({ msg: "Authentication temporarily unavailable", code: "unexpected_failure" }, 503);
    if (unknown) {
      assert.equal(body.type, "recovery", "Unknown users must never reach magic-link generation, which can create accounts");
      return json({ msg: "User with this email not found", code: "user_not_found" }, 404);
    }
    token = `current-token-${requests.length}`; // A new recovery or magic link replaces the previous token.
    return json({ id: userId, email: body.email, user_metadata: { name: "Asha Creator" }, email_confirmed_at: confirmed ? "2026-01-01T00:00:00Z" : null, hashed_token: token, email_otp: "123456", action_link: "https://auth-email.example.test/verify", redirect_to: "https://app.example.test", verification_type: body.type });
  };
});
beforeEach(() => { requests.length = 0; mails.length = 0; confirmed = true; unknown = false; outage = null; token = ""; });
after(() => { globalThis.fetch = savedFetch; process.env = savedEnv; });

function emailLink(label: string) {
  const match = mails[0]?.text.match(new RegExp(`${label}: (https://[^\\s]+)`));
  assert.ok(match, `Missing ${label} in the text email`);
  return match[1];
}

test("existing-account emails contain a current one-time sign-in link and a compatible reset action", async () => {
  await remindExistingAccount(request("/api/auth/resend", {}), "asha@example.test");
  assert.deepEqual(requests.filter(item => item.path.includes("generate_link")).map(item => item.body.type), ["recovery", "magiclink"]);
  assert.equal(mails.length, 1);
  const signin = readAuthEmailLink(emailLink("Log in to my account"));
  const reset = readAuthEmailLink(emailLink("Reset my password"));
  assert.equal(signin.tokenHash, token, "The login link was not invalidated by generating a reset token afterwards");
  assert.equal(signin.intent, "signin");
  assert.equal(signin.next, "/post-login");
  assert.equal(reset.tokenHash, token);
  assert.equal(reset.next, "/reset-password");
  assert.equal(new URL(emailLink("Log in to my account")).origin, "https://app.example.test");
  assert.match(mails[0].text, /won't need to enter your password/);
  assert.match(mails[0].html, /Hi Asha,/);
  assert.ok(!mails[0].html.includes("/login?next=/"), "The primary action never falls back to a password form");
});

test("duplicate signup sends sign-in mail without changing the existing password or profile", async () => {
  const response = await signup(request("/api/auth/signup", { email: "ASHA@example.test", password: "a-different-password", name: "New display name" }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "sent" });
  assert.equal(mails.length, 1);
  assert.equal(readAuthEmailLink(emailLink("Log in to my account")).intent, "signin");
  const signinRequests = requests.filter(item => item.body.type === "magiclink" || item.body.type === "recovery");
  for (const item of signinRequests) {
    assert.equal(item.body.email, "asha@example.test");
    assert.equal(item.body.password, undefined);
    assert.equal(item.body.data, undefined);
  }
});

test("unknown resend addresses receive the same public answer without creating users or sending mail", async () => {
  unknown = true;
  const response = await resend(request("/api/auth/resend", { email: "unknown@example.test" }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "sent" });
  assert.equal(mails.length, 0);
  assert.deepEqual(requests.filter(item => item.path.includes("generate_link")).map(item => item.body.type), ["recovery"]);
});

test("unconfirmed users still get email confirmation rather than a returning-user message", async () => {
  confirmed = false;
  await remindExistingAccount(request("/api/auth/resend", {}), "asha@example.test");
  assert.equal(mails[0].subject, "Confirm your Reelencer email");
  const link = readAuthEmailLink(emailLink("Confirm my email"));
  assert.equal(link.tokenHash, token);
  assert.equal(link.intent, "confirm");
  assert.equal(link.type, "magiclink");
});

test("auth outages are retryable and never send an email with a broken login button", async () => {
  for (const provider of ["recovery", "magiclink"] as const) {
    outage = provider;
    const response = await resend(request("/api/auth/resend", { email: "asha@example.test" }), context);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /try again shortly/i);
    assert.equal(body.token_hash, undefined);
    assert.equal(mails.length, 0);
  }
});
