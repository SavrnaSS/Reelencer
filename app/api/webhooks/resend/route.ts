import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { addressOf, verifyWebhookSignature } from "@/lib/email/config";

export const runtime = "nodejs";

// Resend delivery events (Resend → Webhooks → endpoint https://<site>/api/webhooks/resend, signing secret in
// RESEND_WEBHOOK_SECRET). Hard bounces and spam complaints add the address to email_suppressions, so the mailer stops
// sending to it and the domain's reputation stays clean. Other events are acknowledged and ignored.

type ResendEvent = {
  type?: string;
  data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string; subType?: string; message?: string } };
};

export const POST = withApi({ auth: "public", maxBytes: 256 * 1024 }, async (req) => {
  const secret = String(process.env.RESEND_WEBHOOK_SECRET ?? "").trim();
  if (!secret) throw new ApiError(503, "Webhook is not configured.");
  const body = await req.text();
  const valid = verifyWebhookSignature(
    { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature"), body },
    secret
  );
  if (!valid) throw new ApiError(401, "Invalid webhook signature.", "unauthorized");

  const event = JSON.parse(body) as ResendEvent;
  const recipients = (Array.isArray(event.data?.to) ? event.data.to : [event.data?.to]).filter((value): value is string => !!value).map(addressOf);
  // Soft/transient bounces (mailbox full, greylisting) are retried by Resend; only permanent ones are suppressed.
  const permanentBounce = event.type === "email.bounced" && !/transient|undetermined/i.test(event.data?.bounce?.type ?? "");
  const reason = event.type === "email.complained" ? "complained" : permanentBounce ? "bounced" : null;

  if (reason && recipients.length) {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin()
      .from("email_suppressions")
      .upsert(
        recipients.map((email) => ({
          email,
          reason,
          detail: String(event.data?.bounce?.message ?? event.data?.bounce?.subType ?? "").slice(0, 300),
          source_email_id: event.data?.email_id ?? null,
          updated_at: now,
        })),
        { onConflict: "email" }
      );
    databaseError(error);
  }
  return NextResponse.json({ ok: true, handled: reason ?? "ignored" });
});
