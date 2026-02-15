export default {
  async email(message: any, env: any) {
    const raw = await new Response(message.raw).text();
    const payload = {
      raw,
      to: message.to,
      from: message.from,
      subject: message.headers?.get?.("subject") ?? "",
      receivedAt: new Date().toISOString(),
    };

    await fetch(env.GIG_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-inbox-secret": env.GIG_INGEST_SECRET,
      },
      body: JSON.stringify(payload),
    });
  },
};
