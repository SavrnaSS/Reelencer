// app/api/payoutbatches/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Optional: keep responses non-cacheable (good for dashboards)
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

type DbPayoutBatch = {
  id: string | number;
  worker_id: string;
  cycle_label: string;
  period_start: string;
  period_end: string;
  status: string;
  created_at: string;
  processed_at?: string | null;
  paid_at?: string | null;
  method: "UPI" | "Bank" | string;
  notes?: any;
};

type DbPayoutItem = {
  id: string | number;
  batch_id: string | number;
  work_item_id: string;
  worker_id: string;
  handle: string;
  amount_inr: number | string | null;
  status: string;
  reason?: string | null;
};

type DbWorkItem = {
  id: string | number;
  public_id?: string | null;
  review?: any;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workerId = url.searchParams.get("workerId")?.trim();

    if (!workerId) {
      return NextResponse.json({ error: "workerId is required" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // Basic hardening (prevents weird abusive inputs)
    if (workerId.length > 64) {
      return NextResponse.json({ error: "Invalid workerId" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const sb = supabaseAdmin();

    const resolveWorkerUuid = async (id: string) => {
      if (!id.startsWith("WKR-")) return id;
      const { data, error } = await sb.from("profiles").select("id").eq("worker_code", id).maybeSingle();
      if (error || !data?.id) return id;
      return String(data.id);
    };

    const workerUuid = await resolveWorkerUuid(workerId);

    // ✅ 1) Fetch batches for worker
    const { data: batchesRaw, error: batchErr } = await sb
      .from("payout_batches")
      .select("*")
      .eq("worker_id", workerUuid)
      .order("period_start", { ascending: false });

    if (batchErr) {
      return NextResponse.json({ error: batchErr.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const batches = (batchesRaw ?? []) as DbPayoutBatch[];
    const batchIds = batches.map((b) => String(b.id)).filter(Boolean);

    // ✅ 2) Fetch items only if we have batches
    let items: DbPayoutItem[] = [];
    if (batchIds.length > 0) {
      const { data: itemsRaw, error: itemErr } = await sb
        .from("payout_items")
        .select("*")
        .in("batch_id", batchIds);

      if (itemErr) {
        return NextResponse.json({ error: itemErr.message }, { status: 500, headers: NO_STORE_HEADERS });
      }

      items = (itemsRaw ?? []) as DbPayoutItem[];
    }

    const workItemIds = items.map((item) => String(item.work_item_id)).filter(Boolean);
    const workItemMap = new Map<string, DbWorkItem>();
    if (workItemIds.length > 0) {
      const { data: workItemsRaw, error: workItemErr } = await sb
        .from("work_items")
        .select("id, public_id, review")
        .in("id", workItemIds);

      if (workItemErr) {
        return NextResponse.json({ error: workItemErr.message }, { status: 500, headers: NO_STORE_HEADERS });
      }

      for (const workItem of (workItemsRaw ?? []) as DbWorkItem[]) {
        workItemMap.set(String(workItem.id), workItem);
      }
    }

    // ✅ 3) Group items by batch
    const itemsByBatch = new Map<string, any[]>();
    for (const it of items) {
      const bid = String(it.batch_id);
      const workItem = workItemMap.get(String(it.work_item_id));
      const sourceAssignmentId =
        typeof workItem?.review?.assignmentId === "string"
          ? workItem.review.assignmentId
          : typeof workItem?.review?.assignment_id === "string"
            ? workItem.review.assignment_id
            : undefined;
      const arr = itemsByBatch.get(bid) ?? [];
      arr.push({
        id: String(it.id),
        workItemId: it.work_item_id,
        workItemPublicId: workItem?.public_id ?? undefined,
        workerId: it.worker_id,
        handle: it.handle,
        amountINR: Number(it.amount_inr ?? 0),
        status: it.status,
        reason: it.reason ?? undefined,
        sourceAssignmentId,
      });
      itemsByBatch.set(bid, arr);
    }

    // ✅ 4) Shape response exactly how your UI expects
    const payload = batches.map((b) => ({
      id: String(b.id),
      cycleLabel: b.cycle_label,
      periodStart: b.period_start,
      periodEnd: b.period_end,
      status: b.status,
      createdAt: b.created_at,
      processedAt: b.processed_at ?? undefined,
      paidAt: b.paid_at ?? undefined,
      method: b.method,
      items: itemsByBatch.get(String(b.id)) ?? [],
      notes: Array.isArray(b.notes) ? b.notes : b.notes ? [String(b.notes)] : [],
    }));

    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
