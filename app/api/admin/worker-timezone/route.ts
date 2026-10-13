import { withApi } from "@/lib/api/route";
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";
import { updateDevAdminWorkerTimezone } from "../_devData";

const isMissingColumn = (msg?: string | null) => {
  if (!msg) return false;
  return (
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("Could not find the") && msg.includes("column")) ||
    msg.includes("schema cache")
  );
};

async function handlePOST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const body = await req.json().catch(() => ({}));
  const workerId = String(body?.workerId ?? "").trim();
  const timezone = String(body?.timezone ?? "").trim();
  if (!workerId || !timezone) return json(400, { ok: false, error: "workerId/timezone required" });

  if (guard.devBypass) {
    const updated = updateDevAdminWorkerTimezone({ workerId, timezone });
    if (!updated.ok) return json(404, { ok: false, error: updated.error });
    return json(200, { ok: true, worker: updated.worker });
  }

  const sb = supabaseAdmin();
  const byCode = await sb.from("profiles").select("id,worker_code").eq("worker_code", workerId).maybeSingle();
  const workerUuid = byCode.data?.id ? String(byCode.data.id) : workerId;

  let up = await sb.from("profiles").update({ timezone }).eq("id", workerUuid);
  if (up.error && isMissingColumn(up.error.message)) {
    up = await sb.from("workers").update({ timezone }).eq("id", workerId);
  }
  if (up.error) return json(500, { ok: false, error: up.error.message });

  return json(200, { ok: true });
}

export const POST = withApi({ auth: "admin" }, handlePOST);
