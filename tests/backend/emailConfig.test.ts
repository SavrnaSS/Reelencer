import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { isFreeMailbox, resolveProvider, resolveSender, verifyWebhookSignature } from "../../lib/email/config";

test("Resend is preferred whenever its key is set, and MAIL_PROVIDER can force a configured provider", () => {
  const smtp = { SMTP_HOST: "smtp.gmail.com", SMTP_PASS: "x" };
  assert.equal(resolveProvider(smtp), "smtp");
  assert.equal(resolveProvider({ ...smtp, RESEND_API_KEY: "re_1" }), "resend");
  assert.equal(resolveProvider({ ...smtp, RESEND_API_KEY: "re_1", MAIL_PROVIDER: "smtp" }), "smtp");
  assert.equal(resolveProvider({ MAIL_PROVIDER: "resend" }), null);
  assert.equal(resolveProvider({}), null);
});

test("Resend never sends from a Gmail SMTP_FROM; it uses the business domain", () => {
  const env = { RESEND_API_KEY: "re_1", SMTP_FROM: "KYC <someone@gmail.com>" };
  assert.deepEqual(resolveSender("resend", env), { from: "Reelencer <hello@reelencer.com>", address: "hello@reelencer.com", problem: undefined });
  const custom = resolveSender("resend", { MAIL_FROM: "Reelencer Team <team@reelencer.com>" });
  assert.equal(custom.from, "Reelencer Team <team@reelencer.com>");
  assert.match(resolveSender("resend", { MAIL_FROM: "me@gmail.com" }).problem ?? "", /can't send from gmail\.com/);
  // SMTP keeps its own (Gmail) account as the sender, still branded.
  assert.equal(resolveSender("smtp", env, "someone@gmail.com").from, "Reelencer <someone@gmail.com>");
  assert.equal(isFreeMailbox("a@outlook.com"), true);
  assert.equal(isFreeMailbox("a@reelencer.com"), false);
});

test("Resend webhook signatures are verified (Svix scheme) and stale or forged ones rejected", () => {
  const key = Buffer.from("test-signing-key-123456");
  const secret = `whsec_${key.toString("base64")}`;
  const body = JSON.stringify({ type: "email.bounced" });
  const timestamp = "1760000000";
  const sign = (k: Buffer) => createHmac("sha256", k).update(`msg_1.${timestamp}.${body}`).digest("base64");
  const now = 1760000000 * 1000;
  assert.equal(verifyWebhookSignature({ id: "msg_1", timestamp, signature: `v1,bogus v1,${sign(key)}`, body }, secret, now), true);
  assert.equal(verifyWebhookSignature({ id: "msg_1", timestamp, signature: `v1,${sign(Buffer.from("other"))}`, body }, secret, now), false);
  assert.equal(verifyWebhookSignature({ id: "msg_1", timestamp, signature: `v1,${sign(key)}`, body: body + " " }, secret, now), false);
  assert.equal(verifyWebhookSignature({ id: "msg_1", timestamp, signature: `v1,${sign(key)}`, body }, secret, now + 10 * 60_000), false);
  assert.equal(verifyWebhookSignature({ id: null, timestamp, signature: `v1,${sign(key)}`, body }, secret, now), false);
});
