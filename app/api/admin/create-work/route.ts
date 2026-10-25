import { randomUUID } from "node:crypto";
import { resolveActiveWorkerUserId } from "@/lib/api/work";
import { withApi } from "@/lib/api/route";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createDevAdminWorkItem } from "../_devData";

function makePublicId() {
  return `WI-${randomUUID()}`;
}

async function handlePOST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason }, { status: gate.status });
  const b = await req.json().catch(() => ({}));

  const workerId = String(b?.workerId ?? "");
  const accountId = String(b?.accountId ?? "");
  const title = String(b?.title ?? "").trim();

  if (!workerId || !accountId || !title) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

  if (gate.devBypass) {
    const created = createDevAdminWorkItem(b);
    if (!created.ok) return NextResponse.json({ ok: false, error: created.error }, { status: 400 });
    return NextResponse.json({ ok: true, workItem: created.workItem });
  }

  const { sadmin, adminId } = gate;
  if (!Number.isFinite(Number(b.rewardINR)) || Number(b.rewardINR) < 0 || Number(b.rewardINR) > 10000000 || !Number.isFinite(Date.parse(String(b.dueAt)))) {
    return NextResponse.json({ error: "Valid reward and deadline are required." }, { status: 400 });
  }
  const public_id = makePublicId();

  const row = {
    public_id,
    title,
    type: b?.type ?? "Reel posting",
    account_id: accountId,
    worker_id: await resolveActiveWorkerUserId(workerId),
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

export const POST = withApi({ auth: "admin" }, handlePOST);
