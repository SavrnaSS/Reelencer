import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function startOfWeek(d: Date) {
  const day = d.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // Monday as start
  const out = new Date(d);
  out.setDate(d.getDate() - diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const workerId = String(body.workerId ?? "").trim();
    if (!workerId) {
      return NextResponse.json({ error: "workerId is required" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const sb = supabaseAdmin();

    const resolveWorkerUuid = async (id: string) => {
      if (!id.startsWith("WKR-")) return id;
      const { data, error } = await sb.from("profiles").select("id").eq("worker_code", id).maybeSingle();
      if (error || !data?.id) return id;
      return String(data.id);
    };

    const workerUuid = await resolveWorkerUuid(workerId);

    const { data: upiRow } = await sb
      .from("upi_configs")
      .select("verified,payout_schedule,payout_day")
      .eq("worker_id", workerUuid)
      .maybeSingle();

    if (!upiRow?.verified) {
      return NextResponse.json({ error: "UPI not verified" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const { data: existingBatch } = await sb
      .from("payout_batches")
      .select("id,status,notes")
      .eq("worker_id", workerUuid)
      .in("status", ["Draft", "Processing"])
      .maybeSingle();

    if (existingBatch?.status === "Processing") {
      return NextResponse.json({ error: "Pending payout request already exists" }, { status: 409, headers: NO_STORE_HEADERS });
    }

    const { data: accountsRaw } = await sb.from("accounts").select("id,handle");
    const handleById = new Map<string, string>((accountsRaw ?? []).map((a: any) => [String(a.id), String(a.handle ?? "")]));

    let itemsRes: any = await sb
      .from("work_items")
      .select("id,worker_id,account_id,reward_inr,status")
      .eq("worker_id", workerUuid)
      .eq("status", "Approved");

    if (itemsRes.error && itemsRes.error.message.includes("column")) {
      itemsRes = await sb
        .from("work_items")
        .select("id,workerId,accountId,rewardINR,status")
        .eq("workerId", workerUuid)
        .eq("status", "Approved");
    }

    if (itemsRes.error) {
      return NextResponse.json({ error: itemsRes.error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const approvedItems: Array<{ id: string; workerId: string; accountId: string; rewardINR: number }> = (itemsRes.data ?? []).map((it: any) => ({
      id: String(it.id),
      workerId: String(it.worker_id ?? it.workerId ?? ""),
      accountId: String(it.account_id ?? it.accountId ?? ""),
      rewardINR: Number(it.reward_inr ?? it.rewardINR ?? 0),
    }));

    if (!approvedItems.length) {
      return NextResponse.json({ error: "No approved items to payout" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const approvedIds = approvedItems.map((i) => i.id);
    const { data: paidItems } = await sb
      .from("payout_items")
      .select("work_item_id,status")
      .in("work_item_id", approvedIds);

    const alreadyIncluded = new Set<string>(
      (paidItems ?? [])
        .filter((p: any) => String(p.status ?? "") !== "Failed")
        .map((p: any) => String(p.work_item_id))
    );
    const eligible = approvedItems.filter((it) => !alreadyIncluded.has(it.id));

    if (!eligible.length) {
      return NextResponse.json({ error: "All approved items already in payout batches" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const now = new Date();
    const schedule = String(upiRow?.payout_schedule ?? "Weekly");
    const periodStart = schedule === "Monthly" ? startOfMonth(now) : startOfWeek(now);
    const cycleLabel =
      schedule === "Monthly"
        ? `Month ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
        : `Week of ${periodStart.toISOString().slice(0, 10)}`;

    let batchId = existingBatch?.status === "Draft" ? String(existingBatch.id) : "";
    if (!batchId) {
      const { data: batchRow, error: batchErr } = await sb
        .from("payout_batches")
        .insert({
          worker_id: workerUuid,
          cycle_label: cycleLabel,
          period_start: periodStart.toISOString().slice(0, 10),
          period_end: now.toISOString().slice(0, 10),
          status: "Draft",
          method: "UPI",
          notes: ["Requested by worker"],
        })
        .select("id")
        .maybeSingle();

      if (batchErr || !batchRow?.id) {
        return NextResponse.json({ error: batchErr?.message || "Failed to create payout batch" }, { status: 500, headers: NO_STORE_HEADERS });
      }
      batchId = String(batchRow.id);
    } else if (!Array.isArray(existingBatch?.notes) || !(existingBatch?.notes as any[]).length) {
      await sb.from("payout_batches").update({ notes: ["Requested by worker"] }).eq("id", batchId);
    }
    const payload = eligible.map((it) => ({
      batch_id: batchId,
      work_item_id: it.id,
      worker_id: workerUuid,
      handle: handleById.get(it.accountId) ?? "",
      amount_inr: it.rewardINR,
      status: "Included",
    }));

    const { error: itemErr } = await sb.from("payout_items").insert(payload);
    if (itemErr) {
      return NextResponse.json({ error: itemErr.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      {
        ok: true,
        batchId,
        itemCount: payload.length,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
