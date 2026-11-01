import { withApi } from "@/lib/api/route";
import { loadWorkerActivity } from "@/lib/api/workerActivity";
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

// Each creator's applications, account setup stages, KYC and join date, for the Workers directory's filters.
async function handleGET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  const { byAlias, gigs } = await loadWorkerActivity(supabaseAdmin());
  return json(200, { ok: true, generatedAt: new Date().toISOString(), gigs, workers: Object.fromEntries(byAlias) });
}

export const GET = withApi({ auth: "admin" }, handleGET);
