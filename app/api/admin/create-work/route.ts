import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

function makePublicId() {
  return `WI-${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason }, { status: 401 });

  const { sadmin, adminId } = gate;
  const b = await req.json().catch(() => ({}));

  const workerId = String(b?.workerId ?? "");
  const accountId = String(b?.accountId ?? "");
  const title = String(b?.title ?? "").trim();

  if (!workerId || !accountId || !title) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

  const public_id = makePublicId();

  const row = {
    public_id,
    title,
    type: b?.type ?? "Reel posting",
    account_id: accountId,
    worker_id: workerId,
    created_by: adminId,
    due_at: b?.dueAt, // should be ISO
    status: "Open",
    priority: b?.priority ?? "P1",
    reward_inr: Number(b?.rewardINR ?? 0),
    est_minutes: Number(b?.estMinutes ?? 10),
    sla_minutes: Number(b?.slaMinutes ?? 30),
    gates: b?.gates ?? {},
  };

  const ins = await sadmin.from("work_items").insert(row).select("*").single();
  if (ins.error) return NextResponse.json({ ok: false, error: ins.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
