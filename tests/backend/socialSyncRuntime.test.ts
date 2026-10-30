import test from "node:test";
import assert from "node:assert/strict";
import { registerSocialSyncScheduler, type SocialSyncSchedulerHost, type SocialSyncSchedulerRuntime } from "../../lib/socialSyncRuntime";

function fixture() {
  let nextId = 0;
  type Timer = { id: number; unref: () => void };
  const intervals = new Map<Timer, () => void>();
  const timeouts = new Map<Timer, () => void>();
  const cleared: number[] = [];
  let unreferenced = 0;
  const create = () => ({ id: ++nextId, unref: () => { unreferenced++; } });
  const runtime: SocialSyncSchedulerRuntime = {
    interval: (callback, ms) => { assert.equal(ms, 60_000); const timer = create(); intervals.set(timer, callback); return timer; },
    timeout: (callback, ms) => { assert.equal(ms, 5_000); const timer = create(); timeouts.set(timer, callback); return timer; },
    clearInterval: timer => { intervals.delete(timer as Timer); cleared.push((timer as Timer).id); },
    clearTimeout: timer => { timeouts.delete(timer as Timer); cleared.push((timer as Timer).id); },
  };
  const host: SocialSyncSchedulerHost = {};
  const register = (run: () => Promise<unknown>, enabled = true, onError: (error: unknown) => void = () => {}) => registerSocialSyncScheduler(host, runtime, { enabled, run, onError });
  const tick = () => { for (const callback of intervals.values()) callback(); };
  const startup = () => { for (const [timer, callback] of timeouts) { timeouts.delete(timer); callback(); } };
  return { host, runtime, intervals, timeouts, cleared, register, tick, startup, scheduler: () => host.socialSyncScheduler, unreferenced: () => unreferenced };
}

function pending() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("registrations reuse one interval and startup timer but invoke the latest loaded runner", async () => {
  const f = fixture(); const calls: string[] = [];
  f.register(async () => { calls.push("old"); });
  f.register(async () => { calls.push("new"); });
  assert.equal(f.intervals.size, 1); assert.equal(f.timeouts.size, 1); assert.equal(f.unreferenced(), 2);
  f.startup(); await flush();
  assert.deepEqual(calls, ["new"]);
  f.register(async () => { calls.push("latest"); });
  f.tick(); await flush();
  assert.deepEqual(calls, ["new", "latest"]);
  assert.equal(f.intervals.size, 1); assert.equal(f.timeouts.size, 0);
});

test("a runner reload preserves an in-flight lock and the next tick uses the new implementation", async () => {
  const f = fixture(), old = pending(), fresh = pending(); const calls: string[] = [];
  f.register(() => { calls.push("old"); return old.promise; });
  f.tick();
  f.register(() => { calls.push("new"); return fresh.promise; });
  f.startup(); f.tick();
  assert.deepEqual(calls, ["old"]);
  assert.equal(f.host.socialSyncScheduler?.busy, true);
  old.resolve(); await flush();
  f.tick(); f.tick();
  assert.deepEqual(calls, ["old", "new"]);
  assert.equal(f.host.socialSyncScheduler?.busy, true);
  fresh.resolve(); await flush();
  assert.equal(f.host.socialSyncScheduler?.busy, false);
});

test("legacy timers are retired and an old completion cannot unlock the replacement scheduler", async () => {
  const f = fixture(), legacyRun = pending(), fresh = pending();
  const timer = f.runtime.interval(() => {}, 60_000), startupTimer = f.runtime.timeout(() => {}, 5_000);
  const legacy = { timer, startupTimer, busy: true };
  f.host.socialSyncScheduler = legacy;
  const oldCompletion = legacyRun.promise.finally(() => { legacy.busy = false; });
  let calls = 0;
  f.register(() => { calls++; return fresh.promise; });
  assert.equal(f.cleared.length, 2); assert.equal(f.intervals.size, 1); assert.equal(f.timeouts.size, 1);
  f.tick();
  legacyRun.resolve(); await oldCompletion; await flush();
  assert.equal(legacy.busy, false);
  assert.equal(f.host.socialSyncScheduler?.busy, true);
  f.tick(); assert.equal(calls, 1, "an older finally cannot allow a duplicate new run");
  fresh.resolve(); await flush();
  assert.equal(f.host.socialSyncScheduler?.busy, false);
});

test("a retired callback cannot run against a newer instance, and shutdown clears both timers", async () => {
  const f = fixture(), old = pending(), fresh = pending();
  let calls = 0;
  f.register(() => old.promise);
  const retiredTick = [...f.intervals.values()][0];
  const retiredStartup = [...f.timeouts.values()][0];
  f.tick();
  f.register(async () => {}, false);
  assert.equal(f.host.socialSyncScheduler, undefined); assert.equal(f.intervals.size, 0); assert.equal(f.timeouts.size, 0);
  f.register(() => { calls++; return fresh.promise; });
  f.tick();
  retiredTick(); retiredStartup(); old.resolve(); await flush();
  assert.equal(calls, 1); assert.equal(f.scheduler()?.busy, true);
  fresh.resolve(); await flush();
  f.register(async () => {}, false);
  assert.equal(f.intervals.size, 0); assert.equal(f.timeouts.size, 0);
});

test("failed runs report through the current handler, release their token and allow retries", async () => {
  const f = fixture(); const messages: string[] = []; let calls = 0;
  f.register(async () => { throw new Error("old"); });
  f.register(async () => { calls++; throw new Error("failed"); }, true, error => { messages.push((error as Error).message); });
  f.tick(); await flush();
  assert.deepEqual(messages, ["failed"]); assert.equal(f.host.socialSyncScheduler?.busy, false);
  f.tick(); await flush();
  assert.equal(calls, 2);
});
