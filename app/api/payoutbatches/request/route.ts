import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildPayoutReadiness, type KycStatus } from "@/lib/payoutReadiness";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const MIN_PAYOUT_REQUEST_INR = 1000;

async function getUserId(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

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
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const body = await req.json();
    const requestedWorkerId = String(body.workerId ?? "").trim();

    const sb = supabaseAdmin();
    const [profileRes, workerRes, kycRes] = await Promise.all([
      sb.from("profiles").select("id,worker_code").eq("id", userId).maybeSingle(),
      sb.from("workers").select("id").eq("user_id", userId).maybeSingle(),
      sb
        .from("worker_kyc")
        .select("status,rejection_reason")
        .eq("user_id", userId)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (profileRes.error) {
      return NextResponse.json({ error: profileRes.error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const workerUuid = userId;
    const workerAliases = new Set<string>(
      [userId, String(profileRes.data?.worker_code ?? ""), String(workerRes.data?.id ?? "")]
        .map((value) => value.trim())
        .filter(Boolean)
    );

    if (requestedWorkerId && !workerAliases.has(requestedWorkerId)) {
      return NextResponse.json({ error: "Worker mismatch for payout request" }, { status: 403, headers: NO_STORE_HEADERS });
    }

    const { data: upiRow } = await sb
      .from("upi_configs")
      .select("verified,payout_schedule,payout_day")
      .eq("worker_id", workerUuid)
      .maybeSingle();

    const { data: existingBatch } = await sb
      .from("payout_batches")
      .select("id,status,notes")
      .eq("worker_id", workerUuid)
      .in("status", ["Draft", "Processing"])
      .maybeSingle();

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

    const approvedIds = approvedItems.map((i) => i.id);
    const { data: paidItems } = approvedIds.length
      ? await sb.from("payout_items").select("work_item_id,status").in("work_item_id", approvedIds)
      : { data: [] as any[] };

    const alreadyIncluded = new Set<string>(
      (paidItems ?? [])
        .filter((p: any) => String(p.status ?? "") !== "Failed")
        .map((p: any) => String(p.work_item_id))
    );
    const eligible = approvedItems.filter((it) => !alreadyIncluded.has(it.id));

    const eligibleTotal = eligible.reduce((sum, item) => sum + Number(item.rewardINR ?? 0), 0);
    const kycStatus = String(kycRes.data?.status ?? "none") as KycStatus;
    const payoutReadiness = buildPayoutReadiness({
      kycStatus,
      kycRejectionReason: String(kycRes.data?.rejection_reason ?? "").trim() || null,
      upiVerified: Boolean(upiRow?.verified),
      hasActiveBatch: Boolean(existingBatch?.id),
      eligibleItemCount: eligible.length,
      eligibleAmount: eligibleTotal,
      minimumAmount: MIN_PAYOUT_REQUEST_INR,
    });

    if (!payoutReadiness.ready) {
      return NextResponse.json(
        {
          error: payoutReadiness.primaryBlocker?.detail || "Payout request is blocked",
          code: payoutReadiness.primaryBlocker?.code ?? "blocked",
          blockers: payoutReadiness.blockers,
          minimumRequired: MIN_PAYOUT_REQUEST_INR,
          eligibleAmount: eligibleTotal,
          kycStatus,
        },
        { status: payoutReadiness.primaryBlocker?.code === "active_batch" ? 409 : 400, headers: NO_STORE_HEADERS }
      );
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
