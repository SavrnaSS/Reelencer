import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason }, { status: 401 });

  const { sadmin, adminId } = gate;
  const b = await req.json().catch(() => ({}));

  const workerId = String(b?.workerId ?? "");
  const accountId = String(b?.accountId ?? "");
  if (!workerId || !accountId) return NextResponse.json({ ok: false, error: "Missing ids" }, { status: 400 });

  const ins = await sadmin
    .from("worker_account_assignments")
    .insert({ worker_id: workerId, account_id: accountId, assigned_by: adminId })
    .select("id")
    .maybeSingle();

  if (ins.error) return NextResponse.json({ ok: false, error: ins.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
