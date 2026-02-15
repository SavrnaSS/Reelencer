import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason }, { status: 401 });

  const { sadmin } = gate;
  const b = await req.json().catch(() => ({}));

  const userId = String(b?.userId ?? "");
  const role = String(b?.role ?? "");
  if (!userId || !["Admin", "Worker"].includes(role)) {
    return NextResponse.json({ ok: false, error: "Invalid params" }, { status: 400 });
  }

  const up = await sadmin.from("profiles").update({ role }).eq("id", userId);
  if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
