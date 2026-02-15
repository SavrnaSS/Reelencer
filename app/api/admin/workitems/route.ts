import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => null);
  if (!body?.id || !body?.title || !body?.type || !body?.accountId || !body?.workerId || !body?.dueAt) {
    return json(400, { ok: false, error: "Missing required fields" });
  }

  const payload = {
    id: body.id,
    title: body.title,
    type: body.type,
    account_id: body.accountId,
    worker_id: body.workerId,
    created_at: body.createdAt ?? new Date().toISOString().slice(0, 10),
    due_at: body.dueAt,
    status: "Open",
    priority: body.priority ?? "P2",
    reward_inr: body.rewardINR ?? 0,
    est_minutes: body.estMinutes ?? 0,
    sla_minutes: body.slaMinutes ?? 0,
    gate_caption_template: true,
    gate_approved_audio: true,
    gate_hashtags_ok: true,
    gate_no_restricted: true,
    gate_proof_attached: false,
  };

  const { error } = await sb.from("work_items").insert(payload);
  if (error) return json(500, { ok: false, error: error.message });

  await sb.from("work_item_audit").insert({
    work_item_id: body.id,
    by_role: "Admin",
    by_label: "Admin",
    text: "Created work item.",
  });

  return json(200, { ok: true });
}
