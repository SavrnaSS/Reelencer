import test from "node:test";
import assert from "node:assert/strict";
import { authEmailLink, readAuthEmailLink, safeAuthEmailNext } from "../../lib/authEmailLinks";

test("sign-in credentials stay in the fragment and lead to authenticated account routing", () => {
  const link = authEmailLink("https://reelencer.example", "private-token", "magiclink", "signin");
  const url = new URL(link);
  assert.equal(url.pathname, "/auth/confirm");
  assert.equal(url.search, "?intent=signin");
  assert.ok(!`${url.origin}${url.pathname}${url.search}`.includes("private-token"));
  assert.deepEqual(readAuthEmailLink(link), {
    tokenHash: "private-token", type: "magiclink", intent: "signin", next: "/post-login", cleanPath: "/auth/confirm?intent=signin",
  });
});

test("the same credential can open password reset without issuing a token that invalidates sign-in", () => {
  const signin = readAuthEmailLink(authEmailLink("https://reelencer.example", "one-token", "magiclink", "signin"));
  const reset = readAuthEmailLink(authEmailLink("https://reelencer.example", "one-token", "magiclink", "reset"));
  assert.equal(signin.tokenHash, reset.tokenHash);
  assert.equal(reset.type, "magiclink");
  assert.equal(reset.intent, "reset");
  assert.equal(reset.next, "/reset-password");
});

test("previously sent confirmation and recovery query links continue to work", () => {
  assert.equal(readAuthEmailLink("/auth/confirm?token_hash=old&type=signup&next=%2Fdashboard%3Fsection%3Djobs").next, "/dashboard?section=jobs");
  const recovery = readAuthEmailLink("/auth/confirm?token_hash=old&type=recovery&next=%2Fadmin&intent=signin");
  assert.equal(recovery.intent, "reset");
  assert.equal(recovery.next, "/reset-password");
});

test("unsafe browser redirects cannot escape the application origin", () => {
  for (const next of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "/\tevil.example", "/\nevil.example", "javascript:alert(1)", "/bad\u0000path"]) {
    assert.equal(safeAuthEmailNext(next), "/post-login", String(next));
  }
  assert.equal(safeAuthEmailNext("/dashboard?section=jobs#today"), "/dashboard?section=jobs#today");
  assert.equal(safeAuthEmailNext("/dashboard/../post-login"), "/post-login");
});

test("fragment and query credentials are never combined and unsupported OTP types are rejected", () => {
  const link = readAuthEmailLink("/auth/confirm?token_hash=query&type=signup#token_hash=fragment");
  assert.equal(link.tokenHash, "fragment");
  assert.equal(link.type, null);
  assert.equal(readAuthEmailLink("/auth/confirm?token_hash=token&type=sms").type, null);
  assert.equal(readAuthEmailLink("/auth/confirm").tokenHash, null);
});
