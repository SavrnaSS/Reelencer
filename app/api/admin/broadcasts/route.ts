import { z } from "zod";
import { withApi } from "@/lib/api/route";
import { ApiError } from "@/lib/api/errors";
import { sendEmail, emailBaseUrl } from "@/lib/email/send";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { fillRecipient } from "@/lib/email/brandEmail";
import { authenticate } from "@/lib/api/auth";
import { BROADCAST_LIMITS, SAMPLE_VARS, isPromotional, renderBroadcast, type BroadcastContent, type BroadcastRecipient, type BroadcastVars } from "@/lib/broadcastEmail";
import { loadWorkerActivity } from "@/lib/api/workerActivity";
import { matchedApplication, type ActivityFilters } from "@/lib/workerActivity";
import { findGigHref } from "@/lib/routes";
import { ACCOUNT_SETUP_ANCHOR } from "@/lib/accountSetup";
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";
import { getAdminWorkers } from "../_workers";

// Bulk email to users picked in the Workers directory. "preview" renders the email; "prepare" resolves who gets it
// (server-side, from the directory: never the client's addresses) and records the broadcast; "send" sends one chunk
// of it. Each recipient's message has an idempotency key, so retrying a chunk can't email anyone twice.

export const maxDuration = 60;

const gig = z.object({
  id: z.string().min(1).max(100), title: z.string().min(1).max(200), company: z.string().min(1).max(160),
  payout: z.string().max(100).optional(), payoutType: z.string().max(80).optional(), platform: z.string().max(80).optional(),
});
const content = z.object({
  kind: z.enum(["terms", "reminder", "promotion", "announcement"]),
  subject: z.string().trim().min(1).max(BROADCAST_LIMITS.subject),
  title: z.string().trim().min(1).max(BROADCAST_LIMITS.title),
  message: z.string().trim().min(1).max(BROADCAST_LIMITS.message),
  ctaLabel: z.string().trim().max(BROADCAST_LIMITS.ctaLabel).optional(),
  ctaUrl: z.string().trim().max(500).optional(),
  gig: gig.nullable().optional(),
});
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), content }),
  z.object({ action: z.literal("test"), content }),
  z.object({
    action: z.literal("prepare"), content, workerIds: z.array(z.string().min(1).max(120)).min(1).max(BROADCAST_LIMITS.recipients),
    // The directory filters that picked the audience: each person's tokens come from the application they matched on.
    filters: z.object({
      gig: z.string().max(100), application: z.enum(["all", "applied", "never", "pending", "accepted", "rejected"]),
      setup: z.enum(["all", "not_started", "code_missing", "unreadable", "awaiting_review", "changes_requested", "verified"]),
      kyc: z.enum(["all", "none", "pending", "approved", "rejected"]), joined: z.enum(["all", "7d", "30d", "new", "established"]),
    }).optional(),
    segment: z.string().max(80).optional(),
  }),
  z.object({ action: z.literal("send"), id: z.string().uuid(), offset: z.number().int().min(0) }),
]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type SkipReason = "no_email" | "deleted" | "suspended" | "unsubscribed" | "bounced" | "complained" | "duplicate";

async function inList(table: "email_unsubscribes" | "email_suppressions", emails: string[], columns: string) {
  const found = new Map<string, string>();
  for (let index = 0; index < emails.length; index += 200) {
    const { data, error } = await supabaseAdmin().from(table).select(columns).in("email", emails.slice(index, index + 200));
    // A missing table (migration not applied yet) must not block service notices.
    if (error) continue;
    for (const row of (data ?? []) as unknown as Array<{ email: string; reason?: string }>) found.set(row.email, row.reason ?? "unsubscribed");
  }
  return found;
}

async function handleGET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  const { data, error } = await supabaseAdmin().from("email_broadcasts")
    .select("id,kind,subject,recipient_count,sent_count,failed_count,status,created_at,completed_at,skipped")
    .order("created_at", { ascending: false }).limit(20);
  if (error) return json(200, { ok: true, broadcasts: [], unavailable: true });
  return json(200, {
    ok: true,
    broadcasts: (data ?? []).map(row => ({
      id: row.id, kind: row.kind, subject: row.subject, recipients: row.recipient_count, sent: row.sent_count, failed: row.failed_count,
      skipped: Array.isArray(row.skipped) ? row.skipped.length : 0, status: row.status, createdAt: row.created_at, completedAt: row.completed_at,
    })),
  });
}

async function handlePOST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Check the email: every field needs a value within its length.", "invalid_input");
  const input = parsed.data;
  const site = emailBaseUrl();
  const sb = supabaseAdmin();

  if (input.action === "preview") {
    const email = renderBroadcast(input.content as BroadcastContent, { name: "Priya Sharma", vars: { ...SAMPLE_VARS, gig_link: `${site}/dashboard?section=find` } }, { siteUrl: site, unsubscribeUrl: isPromotional(input.content.kind) ? `${site}/api/email/unsubscribe` : null });
    // The template marks where the recipient's address goes; show a sample one.
    return json(200, { ok: true, subject: email.subject, html: fillRecipient(email, "priya@example.com").html });
  }

  if (input.action === "test") {
    // A copy to the admin's own inbox, as the creators will see it (not recorded as a broadcast).
    const actor = await authenticate(req);
    const to = String(actor.user.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(to)) throw new ApiError(400, "Your admin account has no email address to send a test to.", "invalid_input");
    const name = String(actor.user.user_metadata?.name ?? actor.user.user_metadata?.full_name ?? "").trim() || to.split("@")[0];
    const promotional = isPromotional(input.content.kind);
    const email = renderBroadcast(input.content as BroadcastContent, { name, vars: { ...SAMPLE_VARS, gig_link: `${site}/dashboard?section=find` } }, { siteUrl: site, unsubscribeUrl: promotional ? unsubscribeUrl(to) : null });
    try {
      await sendEmail({ to, subject: `[Test] ${email.subject}`, html: email.html, text: email.text, category: "system" });
    } catch (error) {
      throw new ApiError(502, error instanceof Error ? error.message.slice(0, 200) : "The test email couldn't be sent.", "mail_failed");
    }
    return json(200, { ok: true, to });
  }

  if (input.action === "prepare") {
    const promotional = isPromotional(input.content.kind);
    // Only Terms reminders reach suspended users; follow-ups and promotions are about work they can't do right now.
    const skipSuspended = input.content.kind !== "terms";
    const [workers, activity] = await Promise.all([getAdminWorkers(sb), loadWorkerActivity(sb)]);
    const directory = new Map(workers.map(worker => [worker.id, worker]));
    const varsFor = (worker: { id: string; userId?: string }): BroadcastVars => {
      const record = activity.byAlias.get(worker.id) ?? (worker.userId ? activity.byAlias.get(worker.userId) : undefined);
      const application = (input.filters ? matchedApplication(record, input.filters as ActivityFilters) : undefined) ?? record?.applications[0];
      if (!application) return {};
      const gig = activity.gigsById.get(application.gigId);
      const needsSetup = ["not_started", "code_missing", "unreadable", "changes_requested"].includes(application.setup);
      return {
        ...(gig ? { gig_title: gig.title, company: gig.company } : {}),
        ...(application.handle ? { handle: application.handle } : {}),
        ...(application.code ? { code: application.code } : {}),
        gig_link: `${site}${findGigHref(application.gigId)}${needsSetup ? `#${ACCOUNT_SETUP_ANCHOR}` : ""}`,
      };
    };
    const candidates: BroadcastRecipient[] = [];
    const skipped: Array<{ workerId: string; name: string; reason: SkipReason }> = [];
    const seen = new Set<string>();
    for (const workerId of new Set(input.workerIds)) {
      const worker = directory.get(workerId);
      const name = worker?.name ?? workerId;
      const email = String(worker?.email ?? "").trim().toLowerCase();
      if (!worker || !EMAIL.test(email)) skipped.push({ workerId, name, reason: "no_email" });
      else if (worker.moderationStatus === "deleted") skipped.push({ workerId, name, reason: "deleted" });
      // Promotions don't go to suspended users; a Terms reminder still does.
      else if (skipSuspended && (worker.moderationStatus === "suspended" || !worker.active)) skipped.push({ workerId, name, reason: "suspended" });
      else if (seen.has(email)) skipped.push({ workerId, name, reason: "duplicate" });
      else { seen.add(email); candidates.push({ workerId, email, name, vars: varsFor(worker) }); }
    }
    const emails = candidates.map(recipient => recipient.email);
    const suppressed = await inList("email_suppressions", emails, "email,reason");
    const unsubscribed = promotional ? await inList("email_unsubscribes", emails, "email") : new Map<string, string>();
    const recipients = candidates.filter(recipient => {
      const reason = suppressed.get(recipient.email);
      // Hard bounces never get mail; spam complaints get no bulk mail at all.
      if (reason === "bounced" || reason === "complained" || reason === "manual") { skipped.push({ workerId: recipient.workerId, name: recipient.name, reason: reason === "complained" ? "complained" : "bounced" }); return false; }
      if (unsubscribed.has(recipient.email)) { skipped.push({ workerId: recipient.workerId, name: recipient.name, reason: "unsubscribed" }); return false; }
      return true;
    });
    if (!recipients.length) return json(200, { ok: true, id: null, recipients: 0, skipped });
    const { data, error } = await sb.from("email_broadcasts").insert({
      created_by: guard.userId, kind: input.content.kind, subject: input.content.subject, content: input.content,
      recipients, recipient_count: recipients.length, skipped, ...(input.segment ? { segment: input.segment } : {}),
    }).select("id").single();
    if (error) throw new ApiError(503, "Bulk email needs the latest database update. Apply it, then try again.", "schema_outdated");
    await sb.from("audit_events").insert({ actor_id: guard.userId, action: "email_broadcast_prepared", resource_id: data.id });
    return json(200, { ok: true, id: data.id, recipients: recipients.length, chunk: BROADCAST_LIMITS.chunk, skipped });
  }

  // send: one chunk, two at a time to stay within the provider's rate limit.
  const { data: broadcast, error } = await sb.from("email_broadcasts").select("id,kind,content,recipients,chunks").eq("id", input.id).maybeSingle();
  if (error || !broadcast) throw new ApiError(404, "This broadcast wasn't found.", "not_found");
  if (input.offset % BROADCAST_LIMITS.chunk !== 0) throw new ApiError(400, "Invalid chunk.", "invalid_input");
  const all = (broadcast.recipients ?? []) as BroadcastRecipient[];
  const slice = all.slice(input.offset, input.offset + BROADCAST_LIMITS.chunk);
  const recorded = (broadcast.chunks ?? {}) as Record<string, { sent: number; failed: number }>;
  if (recorded[String(input.offset)]) return json(200, { ok: true, results: [], repeated: true, sent: recorded[String(input.offset)].sent, failed: recorded[String(input.offset)].failed });

  const kind = broadcast.kind as BroadcastContent["kind"];
  const promotional = isPromotional(kind);
  const results: Array<{ workerId: string; name: string; email: string; ok: boolean; error?: string }> = [];
  let next = 0;
  const worker = async () => {
    while (next < slice.length) {
      const recipient = slice[next++];
      const unsubscribe = promotional ? unsubscribeUrl(recipient.email) : null;
      const mail = renderBroadcast(broadcast.content as BroadcastContent, recipient, { siteUrl: site, unsubscribeUrl: unsubscribe });
      try {
        await sendEmail({
          to: recipient.email, subject: mail.subject, html: mail.html, text: mail.text,
          category: promotional ? "promotions" : kind === "reminder" ? "applications" : "system",
          idempotencyKey: `broadcast:${broadcast.id}:${recipient.email}`,
          headers: unsubscribe ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
        });
        results.push({ ...recipient, ok: true });
      } catch (sendError) {
        results.push({ ...recipient, ok: false, error: sendError instanceof Error ? sendError.message.slice(0, 200) : "Not sent." });
      }
    }
  };
  await Promise.all([worker(), worker()]);
  const sent = results.filter(result => result.ok).length;
  const { data: progress } = await sb.rpc("record_broadcast_chunk", { p_id: broadcast.id, p_offset: input.offset, p_sent: sent, p_failed: results.length - sent });
  return json(200, { ok: true, results: results.map(({ workerId, name, ok, error }) => ({ workerId, name, ok, error })), sent, failed: results.length - sent, status: (progress as { status?: string } | null)?.status ?? null });
}

export const GET = withApi({ auth: "admin" }, handleGET);
export const POST = withApi({ auth: "admin", rateLimit: 120 }, handlePOST);
