type EmailMessage = {
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
  to: string;
  from: string;
  headers: Headers;
  setReject(reason: string): void;
};
type Environment = { GIG_INGEST_URL: string; GIG_INGEST_SECRET: string };

const worker = {
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
