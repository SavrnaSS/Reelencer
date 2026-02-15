import { json, requireAdminFromBearer, supabaseAdmin } from "@/app/api/admin/_utils";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const { id } = await ctx.params;
  const batchId = decodeURIComponent(id ?? "");
  if (!batchId) return json(400, { ok: false, error: "Invalid batch id" });

  let etaDate: string | undefined;
  try {
    const body = await req.json();
    if (body?.etaDate) etaDate = String(body.etaDate);
  } catch {
    // ignore
  }

  const sb = supabaseAdmin();
  const { data: existing } = await sb.from("payout_batches").select("notes").eq("id", batchId).maybeSingle();
  const notes: string[] = Array.isArray(existing?.notes) ? existing.notes.map((n: any) => String(n)) : [];
  const nextNotes = notes.filter((n) => !n.startsWith("ETA:"));
  if (etaDate) nextNotes.push(`ETA:${etaDate}`);

  const { error: batchErr } = await sb
    .from("payout_batches")
    .update({ status: "Processing", processed_at: new Date().toISOString(), notes: nextNotes })
    .eq("id", batchId);

  if (batchErr) return json(500, { ok: false, error: batchErr.message });

  const { error: itemsErr } = await sb
    .from("payout_items")
    .update({ status: "Included" })
    .eq("batch_id", batchId);

  if (itemsErr) return json(500, { ok: false, error: itemsErr.message });

  return json(200, { ok: true });
}
