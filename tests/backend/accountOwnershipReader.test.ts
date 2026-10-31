import test from "node:test";
import assert from "node:assert/strict";
import { createInstagramAccountOwnershipReader } from "../../lib/api/accountOwnershipReader";
import { ProfileNotFoundError, SocialSyncError } from "../../lib/socialSyncSchedule";
import type { InstagramProfile } from "../../lib/api/instagramProfile";

const code = "RL-ABC234";
const config = { metaAccessToken: " configured-token ", metaIgBusinessId: " 12345 " };
const profile: InstagramProfile = { biography: "Creator RL-ABC234", followers: 12, posts: 0, media: [], note: "Identity-checked profile" };
const fail = new SocialSyncError("Public profile requires login", "login_required");
const unavailable = async (): Promise<never> => { throw fail; };

test("readable public biographies need no credentials or official API lookup", async () => {
  let fallbackCalls = 0;
  const read = createInstagramAccountOwnershipReader({
    publicProfile: async (handle, expected) => { assert.equal(handle, "creator"); assert.equal(expected, code); return { ...profile, biography: "Creator ＲＬ－ＡＢＣ２３４", codeFound: false }; },
    config: async () => { fallbackCalls++; return config; },
    businessProfile: async () => { fallbackCalls++; return profile; },
  });
  const result = await read("@Creator", code);
  assert.equal(result.codeFound, true, "shared normalized matching owns the result");
  assert.equal(fallbackCalls, 0);
  assert.equal("media" in result, false);
});

test("a genuine empty public bio is a missing code, not an excuse to invent fallback ownership", async () => {
  const read = createInstagramAccountOwnershipReader({
    publicProfile: async () => ({ ...profile, biography: "", codeFound: true }),
    config: async () => { throw new Error("must not load credentials"); },
    businessProfile: async () => { throw new Error("must not call official API"); },
  });
  assert.equal((await read("creator", code)).codeFound, false);
});

test("already-configured official access rescues an unreadable public biography", async () => {
  const read = createInstagramAccountOwnershipReader({
    publicProfile: unavailable,
    config: async () => config,
    businessProfile: async (handle, effective, signal) => {
      assert.equal(handle, "creator");
      assert.deepEqual(effective, { metaAccessToken: "configured-token", metaIgBusinessId: "12345" });
      assert.equal(signal?.aborted, false);
      return { ...profile, externalId: "verified-identity" };
    },
  });
  const result = await read("creator", code);
  assert.equal(result.codeFound, true);
  assert.equal(result.externalId, "verified-identity");
  assert.equal("metaAccessToken" in result, false);
});

test("missing biographies cannot prove ownership even if a provider supplies a codeFound flag", async () => {
  const read = createInstagramAccountOwnershipReader({
    publicProfile: async () => ({ note: "Stats only", codeFound: true }),
    config: async () => config,
    businessProfile: async () => ({ ...profile, biography: undefined }),
  });
  await assert.rejects(read("creator", code), /did not expose.*biography/);
});

test("unconfigured or failed official access preserves confirmed absence and public rate limits", async () => {
  for (const original of [new ProfileNotFoundError("Profile not found"), new SocialSyncError("Public rate limit", "rate_limited", 120_000)]) {
    for (const configured of [false, true]) {
      const read = createInstagramAccountOwnershipReader({
        publicProfile: async () => { throw original; },
        config: async () => configured ? config : { metaAccessToken: "", metaIgBusinessId: "" },
        businessProfile: async () => { throw new SocialSyncError("Meta account not eligible", "unavailable"); },
      });
      await assert.rejects(read("creator", code), error => error === original);
    }
  }
});

test("official fallback rate limits remain actionable without reducing an existing longer retry", async () => {
  for (const [original, wait] of [[fail, 90_000], [new SocialSyncError("Public rate limit", "rate_limited", 180_000), 180_000]] as const) {
    const read = createInstagramAccountOwnershipReader({
      publicProfile: async () => { throw original; }, config: async () => config,
      businessProfile: async () => { throw new SocialSyncError("Meta rate limit", "rate_limited", 90_000); },
    });
    await assert.rejects(read("creator", code), error => error instanceof SocialSyncError && error.code === "rate_limited" && error.retryAfterMs === wait);
  }
});

test("configuration waits are bounded and late rejections are consumed", async () => {
  let businessCalls = 0;
  const read = createInstagramAccountOwnershipReader({
    publicProfile: unavailable,
    config: async () => new Promise((_, reject) => setTimeout(() => reject(new Error("late config failure")), 30)),
    businessProfile: async () => { businessCalls++; return profile; },
  }, { configMs: 5, totalMs: 60 });
  await assert.rejects(read("creator", code), error => error === fail);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(businessCalls, 0);
});

test("the total deadline bounds a stalled public read without starting another provider", async () => {
  let configCalls = 0;
  const read = createInstagramAccountOwnershipReader({
    publicProfile: async () => new Promise(() => {}),
    config: async () => { configCalls++; return config; },
    businessProfile: async () => profile,
  }, { totalMs: 10 });
  await assert.rejects(read("creator", code), error => error instanceof SocialSyncError && error.code === "timeout");
  assert.equal(configCalls, 0);
});

test("a stalled official fallback is aborted at the shared deadline", async () => {
  let signal: AbortSignal | undefined;
  const read = createInstagramAccountOwnershipReader({
    publicProfile: unavailable, config: async () => config,
    businessProfile: async (_handle, _config, pending) => { signal = pending; return new Promise(() => {}); },
  }, { totalMs: 15 });
  await assert.rejects(read("creator", code), error => error === fail);
  assert.equal(signal?.aborted, true);
});
