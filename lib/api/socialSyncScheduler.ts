import "server-only";
import { runScheduledSocialSync } from "./socialSync";
import { registerSocialSyncScheduler, type SocialSyncSchedulerHost } from "../socialSyncRuntime";

/** Development/long-running Node hosts only. Serverless production uses the authenticated cron endpoint. */
export function startSocialSyncScheduler() {
  const enabled = process.env.SOCIAL_SYNC_IN_PROCESS === "true" || (process.env.NODE_ENV === "development" && process.env.SOCIAL_SYNC_IN_PROCESS !== "false");
  registerSocialSyncScheduler(globalThis as typeof globalThis & SocialSyncSchedulerHost, {
    interval: (callback, ms) => setInterval(callback, ms),
    timeout: (callback, ms) => setTimeout(callback, ms),
    clearInterval: timer => clearInterval(timer as ReturnType<typeof setInterval>),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  }, {
    enabled: enabled && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    run: runScheduledSocialSync,
    onError: () => { console.warn("Automatic account sync could not finish. Check database connectivity and the background social sync migration."); },
  });
}
