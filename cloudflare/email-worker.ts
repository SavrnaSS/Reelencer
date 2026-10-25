type EmailMessage = {
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
  to: string;
  from: string;
  headers: Headers;
  setReject(reason: string): void;
};
type Environment = { GIG_INGEST_URL: string; GIG_INGEST_SECRET: string; SOCIAL_SYNC_URL?: string; WORKER_PURGE_URL?: string; CRON_SECRET?: string };

async function runJob(rawUrl: string, expectedPath: string, label: string, secret: string) {
  const target = new URL(rawUrl);
  if (target.protocol !== "https:" || target.username || target.password || target.pathname !== expectedPath || target.search || target.hash) throw new Error(`Configure an HTTPS ${label} job URL.`);
  const response = await fetch(target, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, redirect: "error", signal: AbortSignal.timeout(55_000) });
  if (!response.ok) throw new Error(`${label} job failed (${response.status}).`);
}

const worker = {
  async scheduled(_event: unknown, env: Environment) {
    if (!env.SOCIAL_SYNC_URL) throw new Error("Configure SOCIAL_SYNC_URL before enabling the social sync cron.");
    if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) throw new Error("Configure the application's CRON_SECRET for social sync.");
    const results = await Promise.allSettled([
      runJob(env.SOCIAL_SYNC_URL, "/api/jobs/social-sync", "social sync", env.CRON_SECRET),
      ...(env.WORKER_PURGE_URL ? [runJob(env.WORKER_PURGE_URL, "/api/jobs/worker-purge", "worker purge", env.CRON_SECRET)] : []),
    ]);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  },
  async email(message: EmailMessage, env: Environment) {
    const target = new URL(env.GIG_INGEST_URL);
    if (target.protocol !== "https:" || target.username || target.password) throw new Error("Configure an HTTPS inbox URL.");
    if (!env.GIG_INGEST_SECRET || env.GIG_INGEST_SECRET.length < 32) throw new Error("Configure GIG_INGEST_SECRET with at least 32 characters.");
    if (message.rawSize > 1024 * 1024) {
      message.setReject("Message exceeds the 1 MiB inbox limit.");
      return;
    }
    const raw = await new Response(message.raw).text();
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-inbox-secret": env.GIG_INGEST_SECRET },
      body: JSON.stringify({ raw, to: message.to, from: message.from, subject: message.headers.get("subject") ?? "", receivedAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Inbox ingest failed: ${response.status}`);
  },
};

export default worker;
