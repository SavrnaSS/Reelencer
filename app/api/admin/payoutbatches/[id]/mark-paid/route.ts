import { json, requireAdminFromBearer, supabaseAdmin } from "@/app/api/admin/_utils";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const { id } = await ctx.params;
  const batchId = decodeURIComponent(id ?? "");
  if (!batchId) return json(400, { ok: false, error: "Invalid batch id" });

  const sb = supabaseAdmin();
  const { error: batchErr } = await sb
    .from("payout_batches")
    .update({ status: "Paid", paid_at: new Date().toISOString() })
    .eq("id", batchId);

  if (batchErr) return json(500, { ok: false, error: batchErr.message });

  const { error: itemsErr } = await sb
    .from("payout_items")
    .update({ status: "Paid" })
    .eq("batch_id", batchId);

  if (itemsErr) return json(500, { ok: false, error: itemsErr.message });

  return json(200, { ok: true });
}
