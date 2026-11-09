import test from "node:test";
import assert from "node:assert/strict";
import { AUTH_COPY, friendlyAuthError, isAuthNetworkFailure } from "../../lib/authErrors";

const fallback = "fallback";

test("known auth errors get written copy", () => {
  assert.equal(friendlyAuthError({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }, fallback), AUTH_COPY.invalidCredentials);
  assert.equal(friendlyAuthError({ code: "email_not_confirmed" }, fallback), AUTH_COPY.emailNotConfirmed);
  assert.equal(friendlyAuthError({ code: "over_request_rate_limit", status: 429 }, fallback), AUTH_COPY.rateLimited);
  assert.equal(friendlyAuthError({ message: "New password should be different from the old password." }, fallback), AUTH_COPY.samePassword);
  assert.equal(friendlyAuthError({ code: "session_not_found" }, fallback), AUTH_COPY.sessionExpired);
});

test("provider and network details never reach creators", () => {
  const network = { code: "supabase_network_error", status: 520, message: "Network request failed: Failed to fetch" };
  assert.equal(isAuthNetworkFailure(network), true);
  assert.equal(friendlyAuthError(network, fallback), AUTH_COPY.unreachable);
  assert.equal(friendlyAuthError(new TypeError("Failed to fetch"), fallback), AUTH_COPY.unreachable);
  assert.equal(friendlyAuthError({ status: 500, message: "Database error querying schema" }, fallback), AUTH_COPY.unavailable);
  assert.equal(friendlyAuthError({ status: 504 }, fallback), AUTH_COPY.unavailable);
  assert.equal(friendlyAuthError(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"), fallback), AUTH_COPY.unavailable);
  assert.equal(friendlyAuthError({ message: "Supabase client internal state XYZ" }, fallback), fallback);
  assert.equal(friendlyAuthError(null, fallback), fallback);
  for (const text of Object.values(AUTH_COPY)) assert.doesNotMatch(text, /supabase/i);
});
