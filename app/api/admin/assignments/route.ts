import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => null);
  const workerId = body?.workerId as string | undefined;
  const accountId = body?.accountId as string | undefined;
  if (!workerId || !accountId) return json(400, { ok: false, error: "workerId and accountId required" });

  const { error } = await sb.from("worker_account_assignments").insert({ worker_id: workerId, account_id: accountId });
  if (error) return json(500, { ok: false, error: error.message });

  return json(200, { ok: true });
}

export async function DELETE(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  const sb = supabaseAdmin();

  const url = new URL(req.url);
  const workerId = url.searchParams.get("workerId");
  const accountId = url.searchParams.get("accountId");
  if (!workerId || !accountId) return json(400, { ok: false, error: "workerId and accountId required" });

  const { error } = await sb.from("worker_account_assignments").delete().eq("worker_id", workerId).eq("account_id", accountId);
  if (error) return json(500, { ok: false, error: error.message });

  return json(200, { ok: true });
}
