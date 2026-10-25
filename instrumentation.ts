export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSocialSyncScheduler } = await import("./lib/api/socialSyncScheduler");
    startSocialSyncScheduler();
    const { startWorkerPurgeScheduler } = await import("./lib/api/workerPurgeScheduler");
    startWorkerPurgeScheduler();
  }
}
