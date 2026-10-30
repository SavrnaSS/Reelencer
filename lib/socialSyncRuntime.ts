type Timer = { unref?: () => unknown };
type Runner = () => Promise<unknown>;

type LegacyScheduler = {
  timer?: Timer;
  busy: boolean;
  startupTimer?: Timer;
};
type CurrentScheduler = LegacyScheduler & {
  version: 2;
  currentRun: Runner;
  currentOnError: (error: unknown) => void;
  activeRun?: symbol;
};
export type SocialSyncSchedulerHost = { socialSyncScheduler?: LegacyScheduler | CurrentScheduler };
export type SocialSyncSchedulerRuntime = {
  interval: (callback: () => void, ms: number) => Timer;
  timeout: (callback: () => void, ms: number) => Timer;
  clearInterval: (timer: Timer) => void;
  clearTimeout: (timer: Timer) => void;
};

function current(state: LegacyScheduler | CurrentScheduler | undefined): state is CurrentScheduler {
  return !!state && "version" in state && state.version === 2 &&
    "currentRun" in state && typeof state.currentRun === "function" &&
    "currentOnError" in state && typeof state.currentOnError === "function";
}

/** Keep one timer across registrations while replacing the implementation it invokes. */
export function registerSocialSyncScheduler(
  host: SocialSyncSchedulerHost,
  runtime: SocialSyncSchedulerRuntime,
  { enabled, run, onError }: { enabled: boolean; run: Runner; onError: (error: unknown) => void },
) {
  const previous = host.socialSyncScheduler;
  if (enabled && current(previous)) {
    // Instrumentation can reload while an earlier request is running. Keep its lock,
    // but make every subsequent tick use the newly imported sync implementation.
    previous.currentRun = run;
    previous.currentOnError = onError;
    return;
  }
  if (previous?.timer) runtime.clearInterval(previous.timer);
  if (previous?.startupTimer) runtime.clearTimeout(previous.startupTimer);
  delete host.socialSyncScheduler;
  if (!enabled) return;

  const state: CurrentScheduler = { version: 2, busy: false, currentRun: run, currentOnError: onError };
  host.socialSyncScheduler = state;
  const tick = async () => {
    if (host.socialSyncScheduler !== state || state.activeRun) return;
    const token = Symbol("social sync run");
    state.activeRun = token;
    state.busy = true;
    try { await state.currentRun(); }
    catch (error) {
      // A replaced scheduler cannot report errors through the newer instance.
      if (host.socialSyncScheduler === state) {
        try { state.currentOnError(error); } catch { /* Logging must not stop the queue. */ }
      }
    } finally {
      if (host.socialSyncScheduler === state && state.activeRun === token) {
        state.activeRun = undefined;
        state.busy = false;
      }
    }
  };
  state.timer = runtime.interval(() => { void tick(); }, 60_000);
  state.timer.unref?.();
  state.startupTimer = runtime.timeout(() => {
    state.startupTimer = undefined;
    void tick();
  }, 5_000);
  state.startupTimer.unref?.();
}
