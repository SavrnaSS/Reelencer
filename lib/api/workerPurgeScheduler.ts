import "server-only";
import { purgeDeletedWorkers } from "./workerPurge";

export function startWorkerPurgeScheduler() {
  const enabled = process.env.WORKER_PURGE_IN_PROCESS === "true" || (process.env.NODE_ENV === "development" && process.env.WORKER_PURGE_IN_PROCESS !== "false");
  if (!enabled || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const global = globalThis as typeof globalThis & { workerPurgeScheduler?: { timer: ReturnType<typeof setInterval>; busy: boolean } };
  if (global.workerPurgeScheduler) return;
  const tick = async () => {
    const state = global.workerPurgeScheduler;
    if (!state || state.busy) return;
    state.busy = true;
    try { await purgeDeletedWorkers(); }
    catch { console.warn("Worker cleanup could not finish. Check the deletion migration and database connectivity; the durable queue will retry."); }
    finally { state.busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, 60_000);
  timer.unref();
  global.workerPurgeScheduler = { timer, busy: false };
  setTimeout(() => { void tick(); }, 10_000).unref();
}
