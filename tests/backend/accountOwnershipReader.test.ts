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

test("public biographies work without an authenticated connection", async () => {
  let fallbackCalls = 0;
  const read = createInstagramAccountOwnershipReader({
    publicProfile: async (handle, expected) => { assert.equal(handle, "creator"); assert.equal(expected, code); return { ...profile, biography: "Creator ＲＬ－ＡＢＣ２３４", codeFound: false }; },
    config: async () => ({ metaAccessToken: "", metaIgBusinessId: "" }),
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
    config: async () => ({ metaAccessToken: "", metaIgBusinessId: "" }),
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
    config: async () => { configCalls++; return { metaAccessToken: "", metaIgBusinessId: "" }; },
    businessProfile: async () => profile,
  }, { totalMs: 10 });
  await assert.rejects(read("creator", code), error => error instanceof SocialSyncError && error.code === "timeout");
  assert.equal(configCalls, 1);
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

test("simultaneous checks share a biography read but match each application's own code", async () => {
  let calls = 0, release: (() => void) | undefined, started: (() => void) | undefined;
  const didStart = new Promise<void>(resolve => { started = resolve; });
  const read = createInstagramAccountOwnershipReader({
    publicProfile: async () => {
      calls++; started?.();
      await new Promise<void>(resolve => { release = resolve; });
      return { ...profile, source: "public_profile" };
    },
    config: async () => { throw new Error("Readable biographies need no fallback"); },
    businessProfile: async () => profile,
  });
  const checks = [read("Creator", code), read("@CREATOR", "RL-ZYX987"), read("creator", code)];
  await didStart; release?.();
  const results = await Promise.all(checks);
  assert.equal(calls, 1);
  assert.deepEqual(results.map(result => result.codeFound), [true, false, true]);
  assert.ok(results.every(result => result.biography === profile.biography && result.source === "public_profile"));
});

test("later checks fetch fresh evidence after a success or failure", async () => {
  let calls = 0;
  const read = createInstagramAccountOwnershipReader({
    publicProfile: async () => {
      calls++;
      if (calls === 1) throw fail;
      return { ...profile, biography: calls === 2 ? profile.biography : "The code was removed" };
    },
    config: async () => ({ metaAccessToken: "", metaIgBusinessId: "" }),
    businessProfile: async () => profile,
  });
  await assert.rejects(read("creator", code));
  assert.equal((await read("creator", code)).codeFound, true);
  assert.equal((await read("creator", code, { forceRefresh: true })).codeFound, false);
  assert.equal(calls, 3, "failed and successful reads must not freeze subsequent manual checks");
});

test("timed-out public requests receive cancellation rather than continuing in the background", async () => {
  let signal: AbortSignal | undefined;
  const read = createInstagramAccountOwnershipReader({
    publicProfile: async (_handle, _code, pending) => { signal = pending; return new Promise(() => {}); },
    config: async () => ({ metaAccessToken: "", metaIgBusinessId: "" }),
    businessProfile: async () => profile,
  }, { totalMs: 10 });
  await assert.rejects(read("creator", code), error => error instanceof SocialSyncError && error.code === "timeout");
  assert.equal(signal?.aborted, true);
});

test("configured Meta access is tried before public pages", async () => {
  const calls: string[] = [];
  const read = createInstagramAccountOwnershipReader({
    config: async () => { calls.push("config"); return config; },
    businessProfile: async () => { calls.push("meta"); return profile; },
    publicProfile: async () => { calls.push("public"); throw fail; },
  });
  const result = await read("creator", code);
  assert.deepEqual(calls, ["config", "meta"]);
  assert.equal(result.source, "meta_api");
  assert.equal(result.codeFound, true);
});

test("an authenticated empty bio is not overridden by stale public evidence", async () => {
  const read = createInstagramAccountOwnershipReader({
    config: async () => config,
    businessProfile: async () => ({ ...profile, biography: "" }),
    publicProfile: async () => { assert.fail("An authenticated biography is authoritative"); },
  });
  const result = await read("creator", code);
  assert.equal(result.source, "meta_api");
  assert.equal(result.biography, "");
  assert.equal(result.codeFound, false);
});

test("preview and submission reuse recent evidence while retaining its original read time", async () => {
  let calls = 0;
  const read = createInstagramAccountOwnershipReader({
    config: async () => ({ metaAccessToken: "", metaIgBusinessId: "" }),
    publicProfile: async () => { calls++; return { ...profile, biography: calls === 1 ? profile.biography : "Updated bio" }; },
    businessProfile: async () => profile,
  });
  const preview = await read("creator", code);
  const submission = await read("@Creator", code);
  const otherApplication = await read("creator", "RL-ZYX987");
  assert.equal(calls, 1);
  assert.equal(submission.codeFound, true);
  assert.equal(otherApplication.codeFound, false);
  assert.equal(submission.readAt, preview.readAt);
  assert.ok(preview.readAt && Number.isFinite(Date.parse(preview.readAt)));
  const manual = await read("creator", code, { forceRefresh: true });
  assert.equal(calls, 2);
  assert.equal(manual.biography, "Updated bio");
  assert.equal(manual.codeFound, false);
});

test("expired evidence is fetched again without keeping a successful biography indefinitely", async () => {
  let calls = 0;
  const read = createInstagramAccountOwnershipReader({
    config: async () => ({ metaAccessToken: "", metaIgBusinessId: "" }),
    publicProfile: async () => { calls++; return profile; },
    businessProfile: async () => profile,
  }, { cacheMs: 5 });
  await read("creator", code);
  await new Promise(resolve => setTimeout(resolve, 10));
  await read("creator", code);
  assert.equal(calls, 2);
});

test("a stalled Meta read leaves time for the public fallback", async () => {
  let officialSignal: AbortSignal | undefined, publicCalls = 0;
  const read = createInstagramAccountOwnershipReader({
    config: async () => config,
    businessProfile: async (_handle, _config, signal) => { officialSignal = signal; return new Promise(() => {}); },
    publicProfile: async () => { publicCalls++; return profile; },
  }, { totalMs: 80 });
  const result = await read("creator", code);
  assert.equal(officialSignal?.aborted, true);
  assert.equal(publicCalls, 1);
  assert.equal(result.codeFound, true);
  assert.equal(result.source, "public_profile");
});

test("expired Meta credentials remain actionable when public access is blocked", async () => {
  const read = createInstagramAccountOwnershipReader({
    config: async () => config,
    businessProfile: async () => { throw new SocialSyncError("Reconnect Meta", "credentials"); },
    publicProfile: unavailable,
  });
  await assert.rejects(read("creator", code), error => error instanceof SocialSyncError && error.code === "credentials");
});
