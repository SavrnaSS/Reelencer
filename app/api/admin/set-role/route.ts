import { withApi } from "@/lib/api/route";
import { NextRequest, NextResponse } from "next/server";
import { isAdminOwnerEmail } from "@/lib/adminOwner";
import { requireAdmin } from "@/lib/adminAuth";

async function handlePOST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason }, { status: gate.status });
  if (gate.devBypass) return NextResponse.json({ ok: true });

  const { sadmin } = gate;
  const b = await req.json().catch(() => ({}));

  const userId = String(b?.userId ?? "");
  const role = String(b?.role ?? "");
  if (!userId || !["Admin", "Worker"].includes(role)) {
    return NextResponse.json({ ok: false, error: "Invalid params" }, { status: 400 });
  }

  const target = await sadmin.auth.admin.getUserById(userId);
  if (target.error || !target.data.user) {
    return NextResponse.json({ ok: false, error: target.error?.message || "Target user not found" }, { status: 404 });
  }

  const isOwner = isAdminOwnerEmail(target.data.user.email);
  if ((role === "Admin" && (!isOwner || userId !== gate.adminId)) || (role === "Worker" && isOwner)) {
    return NextResponse.json({ ok: false, error: "Administrator ownership is managed through the server's admin:sync command." }, { status: 403 });
  }

  const up = await sadmin.from("profiles").update({ role }).eq("id", userId);
  if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export const POST = withApi({ auth: "admin" }, handlePOST);
