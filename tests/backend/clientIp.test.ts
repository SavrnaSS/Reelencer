import test from "node:test";
import assert from "node:assert/strict";
import { optionalTrustedClientIp, publicClientIp, trustedClientIp } from "../../lib/api/clientIp";

test("public IP validation canonicalizes IPv6 and mapped addresses without accepting private networks", () => {
  for (const value of [null, "", "garbage", "8.8.8.8, 1.1.1.1", "8.8.8.8:80", "8.8.8.8/32", "127.0.0.1", "10.0.0.1", "192.168.1.1", "100.64.0.1", "169.254.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::1", "fe80::1", "fc00::1", "2001:db8::1", "2002:0808:0808::1", "::ffff:127.0.0.1", "2606:4700::1%eth0"]) {
    assert.equal(publicClientIp(value), null, String(value));
  }
  assert.equal(publicClientIp(" 8.8.8.8 "), "8.8.8.8");
  assert.equal(publicClientIp("2606:4700:4700:0000:0000:0000:0000:1111"), "2606:4700:4700::1111");
  assert.equal(publicClientIp("::ffff:8.8.8.8"), "8.8.8.8");
});

test("client IP ignores arbitrary forwarded headers and fails closed for a configured edge", () => {
  const previous = { header: process.env.TRUSTED_CLIENT_IP_HEADER, vercel: process.env.VERCEL };
  const req = new Request("https://app.example.test/api/me", { headers: { "cf-connecting-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" } });
  try {
    delete process.env.TRUSTED_CLIENT_IP_HEADER;
    delete process.env.VERCEL;
    assert.equal(trustedClientIp(req), null);
    process.env.TRUSTED_CLIENT_IP_HEADER = "cf-connecting-ip";
    assert.equal(trustedClientIp(req), "8.8.8.8");
    assert.throws(() => trustedClientIp(new Request(req.url)), /verified client IP/);
    assert.equal(optionalTrustedClientIp(new Request(req.url)), null, "administrators can recover access while capture is unavailable");
    assert.equal(optionalTrustedClientIp(req), "8.8.8.8");
    process.env.TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";
    assert.throws(() => trustedClientIp(new Request(req.url, { headers: { "x-forwarded-for": "8.8.8.8, 1.1.1.1" } })), /verified client IP/);
    process.env.TRUSTED_CLIENT_IP_HEADER = "client-controlled";
    assert.throws(() => trustedClientIp(req), /not configured correctly/);
    assert.equal(optionalTrustedClientIp(req), null);
    delete process.env.TRUSTED_CLIENT_IP_HEADER;
    process.env.VERCEL = "1";
    assert.equal(trustedClientIp(new Request(req.url, { headers: { "x-vercel-forwarded-for": "1.1.1.1" } })), "1.1.1.1");
  } finally {
    if (previous.header === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER;
    else process.env.TRUSTED_CLIENT_IP_HEADER = previous.header;
    if (previous.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous.vercel;
  }
});
