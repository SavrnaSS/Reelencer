import "server-only";
import { runScheduledSocialSync } from "./socialSync";

/** Development/long-running Node hosts only. Serverless production uses the authenticated cron endpoint. */
export function startSocialSyncScheduler() {
  const enabled = process.env.SOCIAL_SYNC_IN_PROCESS === "true" || (process.env.NODE_ENV === "development" && process.env.SOCIAL_SYNC_IN_PROCESS !== "false");
  if (!enabled || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const state = globalThis as typeof globalThis & { socialSyncScheduler?: { timer: ReturnType<typeof setInterval>; busy: boolean } };
  if (state.socialSyncScheduler) return;
  const tick = async () => {
    const scheduler = state.socialSyncScheduler;
    if (!scheduler || scheduler.busy) return;
    scheduler.busy = true;
    try { await runScheduledSocialSync(); }
    catch { console.warn("Automatic account sync could not finish. Check database connectivity and the background social sync migration."); }
    finally { scheduler.busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, 60_000);
  timer.unref();
  state.socialSyncScheduler = { timer, busy: false };
  setTimeout(() => { void tick(); }, 5000).unref();
}
