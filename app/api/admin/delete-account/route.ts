import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const body = await req.json().catch(() => null);
  const accountId = String(body?.accountId ?? "").trim();
  if (!accountId) return json(400, { ok: false, error: "accountId is required" });

  const sb = supabaseAdmin();

  const removeAssignments = async () => {
    await sb.from("assignments").delete().eq("accountId", accountId);
    await sb.from("assignments").delete().eq("account_id", accountId);
    await sb.from("worker_account_assignments").delete().eq("account_id", accountId);
    await sb.from("worker_accounts").delete().eq("account_id", accountId);
  };

  await removeAssignments();

  // Best-effort work item cleanup (ignore schema mismatch errors)
  const wiSnake = await sb.from("work_items").delete().eq("account_id", accountId);
  if (wiSnake.error && wiSnake.error.message.includes("column")) {
    await sb.from("work_items").delete().eq("accountId", accountId);
  } else if (!wiSnake.error) {
    await sb.from("work_items").delete().eq("accountId", accountId);
  }

  const accSnake = await sb.from("accounts").delete().eq("id", accountId);
  if (accSnake.error) return json(500, { ok: false, error: accSnake.error.message });

  return json(200, { ok: true });
}
