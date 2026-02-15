// app/api/admin/remove-assignment/route.ts
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const body = await req.json().catch(() => null);
  const workerId = body?.workerId?.trim();
  const accountId = body?.accountId?.trim();
  if (!workerId || !accountId) return json(400, { ok: false, error: "workerId/accountId required" });

  const sb = supabaseAdmin();
  const byCode = await sb.from("profiles").select("id,worker_code").eq("worker_code", workerId).maybeSingle();
  const workerUuid = byCode.data?.id ? String(byCode.data.id) : workerId;

  const isMissingColumn = (msg?: string | null) => {
    if (!msg) return false;
    return (
      (msg.includes("column") && msg.includes("does not exist")) ||
      (msg.includes("Could not find the") && msg.includes("column")) ||
      msg.includes("schema cache")
    );
  };
  const isMissingTable = (msg?: string | null) => !!msg && msg.includes("does not exist");

  const normalizeIds = (ids: Array<string | undefined | null>) =>
    Array.from(new Set(ids.map((x) => String(x || "")).filter((x) => x && x !== "undefined")));
  const workerIds = normalizeIds([workerUuid, workerId]);

  const deleteFromAssignments = async (fieldWorker: string, fieldAccount: string) => {
    let lastErr: any = null;
    for (const wid of workerIds) {
      let res = await sb.from("assignments").delete().eq(fieldWorker, wid).eq(fieldAccount, accountId);
      if (!res.error) return null;
      lastErr = res.error;
    }
    return lastErr;
  };

  let delErr = await deleteFromAssignments("workerId", "accountId");
  if (delErr && isMissingColumn(delErr.message)) {
    delErr = await deleteFromAssignments("worker_id", "account_id");
  }
  if (delErr && (isMissingColumn(delErr.message) || isMissingTable(delErr.message))) {
    for (const wid of workerIds) {
      const res = await sb.from("worker_account_assignments").delete().eq("worker_id", wid).eq("account_id", accountId);
      if (!res.error) {
        delErr = null;
        break;
      }
      delErr = res.error;
    }
  }
  if (delErr) return json(500, { ok: false, error: delErr.message });

  for (const wid of workerIds) {
    await sb.from("worker_accounts").delete().eq("worker_id", wid).eq("account_id", accountId);
  }

  const cancelledAt = new Date().toISOString();
  let workUpdate = await sb
    .from("work_items")
    .update({ status: "Cancelled", completed_at: cancelledAt })
    .eq("status", "Open")
    .eq("account_id", accountId)
    .in("worker_id", [workerUuid, workerId]);
  if (workUpdate.error && isMissingColumn(workUpdate.error.message)) {
    workUpdate = await sb
      .from("work_items")
      .update({ status: "Cancelled", completedAt: cancelledAt })
      .eq("status", "Open")
      .eq("accountId", accountId)
      .in("workerId", [workerUuid, workerId]);
  }

  return json(200, { ok: true });
}
