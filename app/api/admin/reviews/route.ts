import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

const isMissingColumn = (msg?: string | null) => {
  if (!msg) return false;
  return (
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("Could not find the") && msg.includes("column")) ||
    msg.includes("schema cache")
  );
};

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => null);
  const workItemId = body?.workItemId as string | undefined;
  const decision = body?.decision as "Approved" | "Rejected" | "Hard rejected" | undefined;
  const reason = (body?.reason as string | undefined) ?? null;

  if (!workItemId || !decision) return json(400, { ok: false, error: "workItemId and decision required" });

  // Update status
  const nextStatus = decision === "Approved" ? "Approved" : decision === "Rejected" ? "Needs fix" : "Hard rejected";

  const completedAt = nextStatus === "Approved" || nextStatus === "Hard rejected" ? new Date().toISOString() : null;
  const review = {
    reviewedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    reviewer: "Admin",
    decision: nextStatus,
    rejectReason: reason || undefined,
  };

  let up = await sb
    .from("work_items")
    .update({ status: nextStatus, review, completed_at: completedAt })
    .eq("id", workItemId);
  if (up.error && isMissingColumn(up.error.message)) {
    up = await sb
      .from("work_items")
      .update({ status: nextStatus, review, completedAt })
      .eq("id", workItemId);
  }

  if (up.error) return json(500, { ok: false, error: up.error.message });

  return json(200, { ok: true, status: nextStatus });
}
