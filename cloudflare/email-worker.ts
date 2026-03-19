export default {
  async email(message: any, env: any) {
    if (!env.GIG_INGEST_URL) {
      throw new Error("Missing GIG_INGEST_URL");
    }
    if (!env.GIG_INGEST_SECRET) {
      throw new Error("Missing GIG_INGEST_SECRET");
    }

    const raw = await new Response(message.raw).text();
    const payload = {
      raw,
      to: message.to,
      from: message.from,
      subject: message.headers?.get?.("subject") ?? "",
      receivedAt: new Date().toISOString(),
    };

    const response = await fetch(env.GIG_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-inbox-secret": env.GIG_INGEST_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Inbox ingest failed: ${response.status} ${bodyText}`.trim());
    }
  },
};
