export type AdminLiveKind =
  | "upi_configs"
  | "worker_kyc"
  | "payout_batches"
  | "view_payout_claims"
  | "social_account_requests"
  | "work_items"
  | "gig_applications"
  | "gig_assignments"
  | "gig_account_credentials";
export type AdminLiveState = "connecting" | "live" | "offline";

type Change = Set<AdminLiveKind> | null;
type Disconnect = () => void | Promise<void>;
type Subscriber = {
  onChange: (kinds: Change) => void;
  pollMs: number;
  refreshOnConnect: boolean;
  connected: boolean;
  pending: Change;
  dirty: boolean;
  lastReadAt: number;
};
type Runtime = {
  now: () => number;
  visible: () => boolean;
  online: () => boolean;
  timeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  interval: (callback: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  listen: (event: "visibilitychange" | "focus" | "online" | "offline", callback: () => void) => () => void;
  connect: (onChange: (kind: AdminLiveKind | null) => void, onState: (state: AdminLiveState) => void, signal: AbortSignal) => Promise<Disconnect>;
};

/** Shares only invalidation signals. Account data and credentials never enter this coordinator. */
export function createAdminLiveCoordinator(runtime: Runtime) {
  const subscribers = new Set<Subscriber>();
  const stateListeners = new Set<() => void>();
  let state: AdminLiveState = "connecting";
  let flushTimer: number | undefined;
  let pollTimer: number | undefined;
  let cleanups: Array<() => void> = [];
  let disconnect: Disconnect | undefined;
  let tearingDown: Promise<void> | undefined;
  let connecting = false;
  let transportState: AdminLiveState = "connecting";
  let connectionController: AbortController | undefined;
  let generation = 0;

  const setState = (next: AdminLiveState) => {
    if (state === next) return;
    state = next;
    stateListeners.forEach(listener => listener());
  };
  const active = () => runtime.visible() && runtime.online();
  const flush = () => {
    flushTimer = undefined;
    if (!active()) return; // Keep invalidations until this tab can read again.
    subscribers.forEach(subscriber => {
      if (!subscriber.dirty) return;
      const pending = subscriber.pending;
      subscriber.pending = new Set();
      subscriber.dirty = false;
      subscriber.lastReadAt = runtime.now();
      subscriber.onChange(pending);
    });
  };
  const queue = (subscriber: Subscriber, kind: AdminLiveKind | null) => {
    if (kind === null) subscriber.pending = null;
    else subscriber.pending?.add(kind);
    subscriber.dirty = true;
    if (active() && flushTimer === undefined) flushTimer = runtime.timeout(flush, 400);
  };
  const queueAll = (kind: AdminLiveKind | null) => subscribers.forEach(subscriber => queue(subscriber, kind));
  const stopConnection = (stop: Disconnect) => {
    const result = stop();
    if (!result) return;
    const pending = Promise.resolve(result).catch(() => undefined);
    tearingDown = pending;
    void pending.then(() => { if (tearingDown === pending) tearingDown = undefined; });
  };

  const connect = async () => {
    if (connecting || disconnect || !subscribers.size || !runtime.online()) return;
    connecting = true;
    connectionController = new AbortController();
    const version = generation;
    const signal = connectionController.signal;
    transportState = "connecting";
    setState("connecting");
    try {
      // Supabase can reuse a topic until asynchronous channel teardown finishes.
      if (tearingDown) await tearingDown;
      signal.throwIfAborted();
      if (!runtime.online()) {
        setState("offline");
        return;
      }
      setState("connecting");
      const stop = await runtime.connect(
        kind => { if (version === generation) queueAll(kind); },
        next => {
          if (version !== generation) return;
          const wasLive = state === "live";
          transportState = next;
          setState(runtime.online() ? next : "offline");
          if (next !== "live" || wasLive) return;
          subscribers.forEach(subscriber => {
            if (subscriber.connected || subscriber.refreshOnConnect) queue(subscriber, null);
            subscriber.connected = true;
          });
        },
        signal,
      );
      if (version !== generation || !subscribers.size) stopConnection(stop);
      else disconnect = stop;
    } catch {
      if (version === generation) setState("offline");
    } finally {
      if (version === generation) connecting = false;
    }
  };
  const wake = () => {
    if (!active()) return;
    if (disconnect) setState(transportState);
    queueAll(null);
    void connect();
  };
  const resetPoll = () => {
    if (pollTimer !== undefined) runtime.clearInterval(pollTimer);
    pollTimer = undefined;
    if (!subscribers.size) return;
    const interval = Math.min(...[...subscribers].map(subscriber => subscriber.pollMs));
    pollTimer = runtime.interval(() => {
      if (!active()) return;
      void connect();
      const now = runtime.now();
      subscribers.forEach(subscriber => {
        const due = subscriber.pollMs * (state === "live" ? 8 : 1);
        if (now - subscriber.lastReadAt >= due) queue(subscriber, null);
      });
    }, interval);
  };

  return {
    getState: () => state,
    subscribeState: (listener: () => void) => {
      stateListeners.add(listener);
      return () => { stateListeners.delete(listener); };
    },
    subscribe: (onChange: Subscriber["onChange"], { pollMs = 15_000, refreshOnConnect = true }: { pollMs?: number; refreshOnConnect?: boolean } = {}) => {
      const subscriber: Subscriber = {
        onChange,
        pollMs: Number.isFinite(pollMs) && pollMs > 0 ? Math.max(1000, pollMs) : 15_000,
        refreshOnConnect,
        connected: state === "live",
        pending: new Set(),
        dirty: false,
        lastReadAt: runtime.now(),
      };
      subscribers.add(subscriber);
      if (subscribers.size === 1) {
        cleanups = [
          runtime.listen("visibilitychange", wake),
          runtime.listen("focus", wake),
          runtime.listen("online", wake),
          runtime.listen("offline", () => setState("offline")),
        ];
        if (!runtime.online()) setState("offline");
        void connect();
      } else if (state === "live" && refreshOnConnect) queue(subscriber, null);
      resetPoll();
      return () => {
        subscribers.delete(subscriber);
        resetPoll();
        if (subscribers.size) return;
        generation++;
        connecting = false;
        connectionController?.abort();
        connectionController = undefined;
        if (disconnect) stopConnection(disconnect);
        disconnect = undefined;
        cleanups.forEach(cleanup => cleanup());
        cleanups = [];
        if (flushTimer !== undefined) runtime.clearTimeout(flushTimer);
        flushTimer = undefined;
        setState("connecting");
      };
    },
  };
}
