import { withApi } from "@/lib/api/route";
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";
import { getAdminWorkersResult } from "../_workers";

async function handleGET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const result = await getAdminWorkersResult(sb);
  if (result.error && result.workers.length === 0) {
    return json(guard.devBypass ? 200 : 503, { ok: guard.devBypass, workers: result.workers, error: result.error });
  }
  return json(200, { ok: true, workers: result.workers, error: result.error });
}

export const GET = withApi({ auth: "admin" }, handleGET);
