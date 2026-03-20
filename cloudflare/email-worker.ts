const FALLBACK_INGEST_URL = "https://reelencer.com/api/gig-inbox/ingest";
const FALLBACK_INGEST_SECRET = "reelencer_inbox_2026_secure_key_91x";

export default {
  async email(message: any, env: any) {
    const ingestUrl = String(env.GIG_INGEST_URL || FALLBACK_INGEST_URL).trim();
    const ingestSecret = String(env.GIG_INGEST_SECRET || FALLBACK_INGEST_SECRET).trim();
    if (!ingestUrl) throw new Error("Missing GIG_INGEST_URL");
    if (!ingestSecret) throw new Error("Missing GIG_INGEST_SECRET");

    const raw = await new Response(message.raw).text();
    const payload = {
      raw,
      to: message.to,
      from: message.from,
      subject: message.headers?.get?.("subject") ?? "",
      receivedAt: new Date().toISOString(),
    };

    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-inbox-secret": ingestSecret,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Inbox ingest failed: ${response.status} ${bodyText}`.trim());
    }
  },
};
