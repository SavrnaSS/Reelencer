import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

const isMissingColumn = (msg?: string | null) => {
  if (!msg) return false;
  return (
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("Could not find the") && msg.includes("column")) ||
    msg.includes("schema cache")
  );
};

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason }, { status: 401 });

  const { sadmin } = gate;
  const b = await req.json().catch(() => ({}));

  const id = String(b?.id ?? "");
  const requestedStatus = String(b?.status ?? "");
  const normalizedStatus =
    requestedStatus === "Rejected"
      ? "Needs fix"
      : requestedStatus === "Needs fix" || requestedStatus === "Approved" || requestedStatus === "Hard rejected"
        ? requestedStatus
        : "";
  const review = b?.review ?? null;

  if (!id || !normalizedStatus) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });

  // resolve by public_id OR uuid id
  const found = await sadmin.from("work_items").select("id").or(`public_id.eq.${id},id.eq.${id}`).maybeSingle();
  if (found.error || !found.data) return NextResponse.json({ ok: false, error: "Work item not found" }, { status: 404 });

  const completed_at = normalizedStatus === "Approved" || normalizedStatus === "Hard rejected" ? new Date().toISOString() : null;

  let up = await sadmin.from("work_items").update({ status: normalizedStatus, review, completed_at }).eq("id", found.data.id);
  if (up.error && isMissingColumn(up.error.message)) {
    up = await sadmin.from("work_items").update({ status: normalizedStatus, review, completedAt: completed_at }).eq("id", found.data.id);
  }
  if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
