import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

export async function GET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const batchesRes = await sb.from("payout_batches").select("*").order("created_at", { ascending: false });
  if (batchesRes.error) return json(500, { ok: false, error: batchesRes.error.message });

  const batches = (batchesRes.data ?? []) as any[];
  const batchIds = batches.map((b) => String(b.id)).filter(Boolean);
  const workerIds = Array.from(new Set(batches.map((b) => String(b.worker_id ?? "")).filter(Boolean)));

  const itemsRes = batchIds.length
    ? await sb.from("payout_items").select("*").in("batch_id", batchIds)
    : { data: [] as any[], error: null as any };
  if (itemsRes.error) return json(500, { ok: false, error: itemsRes.error.message });

  const profilesRes = workerIds.length
    ? await sb.from("profiles").select("id,worker_code,display_name").in("id", workerIds)
    : { data: [] as any[] };

  const workerById = new Map<string, any>((profilesRes.data ?? []).map((p: any) => [String(p.id), p]));
  const itemsByBatch = new Map<string, any[]>();

  for (const it of itemsRes.data ?? []) {
    const bid = String((it as any).batch_id ?? "");
    const arr = itemsByBatch.get(bid) ?? [];
    arr.push({
      id: String((it as any).id ?? ""),
      workItemId: String((it as any).work_item_id ?? ""),
      workerId: String((it as any).worker_id ?? ""),
      handle: String((it as any).handle ?? ""),
      amountINR: Number((it as any).amount_inr ?? 0),
      status: String((it as any).status ?? ""),
      reason: (it as any).reason ?? undefined,
    });
    itemsByBatch.set(bid, arr);
  }

  return json(200, {
    ok: true,
    payoutBatches: batches.map((b) => {
      const workerId = String(b.worker_id ?? "");
      const prof = workerById.get(workerId);
      return {
        id: String(b.id),
        workerId,
        workerCode: String(prof?.worker_code ?? workerId),
        workerName: String(prof?.display_name ?? "Worker"),
        cycleLabel: b.cycle_label ?? "",
        periodStart: b.period_start ?? "",
        periodEnd: b.period_end ?? "",
        status: b.status ?? "",
        createdAt: b.created_at ?? "",
        processedAt: b.processed_at ?? undefined,
        paidAt: b.paid_at ?? undefined,
        method: b.method ?? "UPI",
        notes: Array.isArray(b.notes) ? b.notes : b.notes ? [String(b.notes)] : [],
        items: itemsByBatch.get(String(b.id)) ?? [],
      };
    }),
  });
}
