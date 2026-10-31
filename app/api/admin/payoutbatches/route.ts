import { withApi } from "@/lib/api/route";
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";
import { getDevAdminPayoutBatches } from "../_devData";

async function handleGET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  if (guard.devBypass) return json(200, { ok: true, payoutBatches: getDevAdminPayoutBatches() });

  const sb = supabaseAdmin();
  const batchesRes = await sb.from("payout_batches").select("*").order("created_at", { ascending: false });
  if (batchesRes.error) return json(500, { ok: false, error: batchesRes.error.message });

  const batches = (batchesRes.data ?? []);
  const batchIds = batches.map((b) => String(b.id)).filter(Boolean);
  const workerIds = Array.from(new Set(batches.map((b) => String(b.worker_id ?? "")).filter(Boolean)));

  const itemsRes = batchIds.length
    ? await sb.from("payout_items").select("*").in("batch_id", batchIds)
    : { data: [], error: null };
  if (itemsRes.error) return json(500, { ok: false, error: itemsRes.error.message });

  const profilesRes = workerIds.length
    ? await sb.from("profiles").select("id,worker_code,display_name").in("id", workerIds)
    : { data: [] };

  const workerById = new Map<string, Record<string, unknown>>((profilesRes.data ?? []).map((p) => [String(p.id), p]));
  const itemsByBatch = new Map<string, Record<string, unknown>[]>();

  for (const it of itemsRes.data ?? []) {
    const bid = String((it).batch_id ?? "");
    const arr = itemsByBatch.get(bid) ?? [];
    arr.push({
      id: String((it).id ?? ""),
      workItemId: String((it).work_item_id ?? ""),
      workerId: String((it).worker_id ?? ""),
      handle: String((it).handle ?? ""),
      amountINR: Number((it).amount_inr ?? 0),
      status: String((it).status ?? ""),
      reason: (it).reason ?? undefined,
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
        // Where this payout must be sent, as requested (destination key + account holder for bank transfers).
        payTo: b.upi_id_snapshot ?? undefined,
        payeeName: b.payee_name_snapshot ?? undefined,
        notes: Array.isArray(b.notes) ? b.notes : b.notes ? [String(b.notes)] : [],
        items: itemsByBatch.get(String(b.id)) ?? [],
      };
    }),
  });
}

export const GET = withApi({ auth: "admin" }, handleGET);
