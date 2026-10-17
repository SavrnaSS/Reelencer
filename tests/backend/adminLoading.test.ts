import test from "node:test";
import assert from "node:assert/strict";
import { createAdminLiveCoordinator, type AdminLiveKind, type AdminLiveState } from "../../lib/adminLiveCoordinator";
import { createAdminReadQueue } from "../../lib/adminReadQueue";

function liveHarness() {
  let now = 0;
  let nextId = 0;
  let visible = true;
  let online = true;
  let connections = 0;
  let disconnections = 0;
  const timers = new Map<number, { at: number; repeat: number; callback: () => void }>();
  const events = new Map<string, Set<() => void>>();
  let onChange: (kind: AdminLiveKind | null) => void = () => undefined;
  let onState: (state: AdminLiveState) => void = () => undefined;
  const coordinator = createAdminLiveCoordinator({
    now: () => now,
    visible: () => visible,
    online: () => online,
    timeout: (callback, ms) => { const id = ++nextId; timers.set(id, { at: now + ms, repeat: 0, callback }); return id; },
    clearTimeout: id => { timers.delete(id); },
    interval: (callback, ms) => { const id = ++nextId; timers.set(id, { at: now + ms, repeat: ms, callback }); return id; },
    clearInterval: id => { timers.delete(id); },
    listen: (event, callback) => {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(callback);
      return () => { events.get(event)?.delete(callback); };
    },
    connect: async (changed, state) => {
      connections++;
      onChange = changed;
      onState = state;
      return () => { disconnections++; };
    },
  });
  return {
    coordinator,
    connections: () => connections,
    disconnections: () => disconnections,
    pending: () => timers.size,
    listeners: () => [...events.values()].reduce((sum, callbacks) => sum + callbacks.size, 0),
    visible: (value: boolean) => { visible = value; },
    online: (value: boolean) => { online = value; },
    emit: (event: string) => events.get(event)?.forEach(callback => callback()),
    changed: (kind: AdminLiveKind | null) => onChange(kind),
    status: (state: AdminLiveState) => onState(state),
    advance: (ms: number) => {
      const target = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.repeat) timer.at += timer.repeat;
        else timers.delete(id);
        timer.callback();
      }
      now = target;
    },
  };
}

test("nested admin panels share one channel and coalesce invalidations without caching data", async () => {
  const h = liveHarness();
  const shell: unknown[] = [];
  const panel: unknown[] = [];
  const offShell = h.coordinator.subscribe(kinds => shell.push(kinds && [...kinds]), { refreshOnConnect: false });
  const offPanel = h.coordinator.subscribe(kinds => panel.push(kinds && [...kinds]), { refreshOnConnect: false });
  await Promise.resolve();
  assert.equal(h.connections(), 1);
  h.status("live");
  h.changed("gig_applications");
  h.changed("gig_applications");
  h.changed("gig_assignments");
  h.advance(400);
  assert.deepEqual(shell, [["gig_applications", "gig_assignments"]]);
  assert.deepEqual(panel, shell);
  offPanel();
  assert.equal(h.disconnections(), 0);
  offShell();
  assert.equal(h.disconnections(), 1);
  assert.equal(h.pending(), 0);
  assert.equal(h.listeners(), 0);
});

test("initial connection opt-out avoids duplicate reads while reconnects catch up every panel", () => {
  const h = liveHarness();
  const initial: unknown[] = [];
  const ownInitialRead: unknown[] = [];
  h.coordinator.subscribe(value => initial.push(value));
  h.coordinator.subscribe(value => ownInitialRead.push(value), { refreshOnConnect: false });
  h.status("live");
  h.advance(400);
  assert.deepEqual(initial, [null]);
  assert.deepEqual(ownInitialRead, []);
  h.status("offline");
  h.status("live");
  h.advance(400);
  assert.deepEqual(initial, [null, null]);
  assert.deepEqual(ownInitialRead, [null]);
});

test("hidden and offline tabs retain invalidations and resume with one full refresh", () => {
  const h = liveHarness();
  const reads: unknown[] = [];
  h.coordinator.subscribe(value => reads.push(value), { refreshOnConnect: false });
  h.status("live");
  h.changed("worker_kyc");
  h.visible(false);
  h.advance(180_000);
  assert.deepEqual(reads, []);
  h.visible(true);
  h.online(false);
  h.emit("offline");
  h.emit("focus");
  h.advance(30_000);
  assert.deepEqual(reads, []);
  assert.equal(h.coordinator.getState(), "offline");
  h.online(true);
  h.emit("online");
  h.emit("focus");
  h.emit("visibilitychange");
  h.advance(400);
  assert.deepEqual(reads, [null]);
});

test("fallback polling respects each panel interval and reduces reads while realtime is live", () => {
  const h = liveHarness();
  const fast: unknown[] = [];
  const slow: unknown[] = [];
  h.coordinator.subscribe(value => fast.push(value), { pollMs: 1000, refreshOnConnect: false });
  h.coordinator.subscribe(value => slow.push(value), { pollMs: 2000, refreshOnConnect: false });
  h.status("live");
  h.advance(8400);
  assert.equal(fast.length, 1);
  assert.equal(slow.length, 0);
  h.advance(8000);
  assert.equal(slow.length, 1);
  h.status("offline");
  h.advance(2000);
  assert.ok(fast.length >= 2);
});

test("late realtime connection is disposed and cannot notify a replacement console", async () => {
  let finish!: (stop: () => void) => void;
  let stateChanged!: (state: AdminLiveState) => void;
  let signal!: AbortSignal;
  let closed = 0;
  const coordinator = createAdminLiveCoordinator({
    now: () => 0, visible: () => true, online: () => true,
    timeout: () => 1, clearTimeout: () => undefined, interval: () => 2, clearInterval: () => undefined,
    listen: () => () => undefined,
    connect: (_change, state, abortSignal) => {
      stateChanged = state;
      signal = abortSignal;
      return new Promise(resolve => { finish = resolve; });
    },
  });
  const off = coordinator.subscribe(() => assert.fail("disposed subscriber received a signal"));
  off();
  assert.equal(signal.aborted, true);
  stateChanged("live");
  assert.equal(coordinator.getState(), "connecting");
  finish(() => { closed++; });
  await Promise.resolve();
  assert.equal(closed, 1);
});

test("a replacement channel waits for pending teardown through offline and online events", async () => {
  let online = true;
  let connections = 0;
  let finishTeardown!: () => void;
  const states: Array<(state: AdminLiveState) => void> = [];
  const events = new Map<string, () => void>();
  const coordinator = createAdminLiveCoordinator({
    now: () => 0, visible: () => true, online: () => online,
    timeout: () => 1, clearTimeout: () => undefined, interval: () => 2, clearInterval: () => undefined,
    listen: (event, callback) => { events.set(event, callback); return () => { events.delete(event); }; },
    connect: async (_change, state) => {
      connections++;
      states.push(state);
      return () => new Promise<void>(resolve => { finishTeardown = resolve; });
    },
  });
  const first = coordinator.subscribe(() => undefined);
  await Promise.resolve();
  first();
  const replacement = coordinator.subscribe(() => undefined);
  online = false;
  events.get("offline")?.();
  online = true;
  events.get("online")?.();
  assert.equal(connections, 1);
  finishTeardown();
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  assert.equal(connections, 2);
  states[0]("live");
  assert.equal(coordinator.getState(), "connecting");
  states[1]("live");
  assert.equal(coordinator.getState(), "live");
  replacement();
  finishTeardown();
});

test("independent resources load concurrently while identical reads share one operation", async () => {
  const queue = createAdminReadQueue();
  let finish!: () => void;
  let calls = 0;
  const read = async () => { calls++; await new Promise<void>(resolve => { finish = resolve; }); };
  const first = queue.run("applications", read);
  const duplicate = queue.run("applications", read);
  let assignmentsLoaded = false;
  await queue.run("assignments", async () => { assignmentsLoaded = true; });
  assert.equal(calls, 1);
  assert.equal(assignmentsLoaded, true);
  finish();
  await Promise.all([first, duplicate]);
});

test("changes arriving during an older read coalesce into one subsequent read", async () => {
  const queue = createAdminReadQueue();
  let finish!: () => void;
  let calls = 0;
  const first = queue.run("applications", async () => { calls++; await new Promise<void>(resolve => { finish = resolve; }); });
  await Promise.resolve();
  const latest = async () => { calls++; };
  const second = queue.run("applications", latest, { afterCurrent: true });
  const third = queue.run("applications", latest, { afterCurrent: true });
  finish();
  await Promise.all([first, second, third]);
  assert.equal(calls, 2);
});

test("unmount aborts current reads and suppresses queued follow-up requests", async () => {
  const queue = createAdminReadQueue();
  let signal!: AbortSignal;
  let finish!: () => void;
  const current = queue.run("kyc", async abortSignal => {
    signal = abortSignal;
    await new Promise<void>(resolve => { finish = resolve; });
  });
  await Promise.resolve();
  let queuedCalls = 0;
  const queued = queue.run("kyc", async () => { queuedCalls++; }, { afterCurrent: true });
  queue.abortAll();
  assert.equal(signal.aborted, true);
  finish();
  await Promise.all([current, queued]);
  assert.equal(queuedCalls, 0);
  await queue.run("kyc", async () => { queuedCalls++; });
  assert.equal(queuedCalls, 1);
});

test("cancelled stale reads cannot overwrite a mutation or release a replacement operation", async () => {
  const queue = createAdminReadQueue();
  let finishOld!: () => void;
  let finishNew!: () => void;
  let renderedStatus = "Applied";
  const old = queue.run("applications", async signal => {
    await new Promise<void>(resolve => { finishOld = resolve; });
    if (!signal.aborted) renderedStatus = "Applied";
  });
  await Promise.resolve();
  queue.abort("applications");
  renderedStatus = "Accepted";
  const replacement = queue.run("applications", async () => {
    await new Promise<void>(resolve => { finishNew = resolve; });
  });
  await Promise.resolve();
  finishOld();
  await old;
  assert.equal(renderedStatus, "Accepted");
  let duplicateReads = 0;
  const duplicate = queue.run("applications", async () => { duplicateReads++; });
  finishNew();
  await Promise.all([replacement, duplicate]);
  assert.equal(duplicateReads, 0);
});

test("failed reads release the operation for retry", async () => {
  const queue = createAdminReadQueue();
  await assert.rejects(queue.run("gigs", () => { throw new Error("network unavailable"); }), /network unavailable/);
  let retried = false;
  await queue.run("gigs", async () => { retried = true; });
  assert.equal(retried, true);
});
