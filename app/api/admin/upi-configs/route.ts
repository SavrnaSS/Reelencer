import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { resolveWorkerUserId } from "@/lib/api/work";
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";
import { getDevAdminUpiConfigs } from "../_devData";

async function handleGET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  if (guard.devBypass) return json(200, { ok: true, upiConfigs: getDevAdminUpiConfigs() });

  const sb = supabaseAdmin();
  const upiRes = await sb
    .from("upi_configs")
    .select("worker_id,upi_id,verified,verified_at,payout_schedule,payout_day");
  if (upiRes.error) return json(500, { ok: false, error: upiRes.error.message });

  const workerIds = Array.from(new Set((upiRes.data ?? []).map((u) => String(u.worker_id ?? "")).filter(Boolean)));
  const profilesRes = workerIds.length
    ? await sb.from("profiles").select("id,worker_code").in("id", workerIds)
    : { data: [] };
  const codeById = new Map<string, string>((profilesRes.data ?? []).map((p) => [String(p.id), String(p.worker_code ?? p.id)]));

  return json(200, {
    ok: true,
    upiConfigs: (upiRes.data ?? []).map((u) => ({
      workerId: String(u.worker_id ?? ""),
      workerCode: codeById.get(String(u.worker_id ?? "")),
      upiId: String(u.upi_id ?? ""),
      verified: !!u.verified,
      verifiedAt: u.verified_at ?? undefined,
      payoutSchedule: u.payout_schedule ?? undefined,
      payoutDay: u.payout_day ?? undefined,
    })),
  });
}

export const GET = withApi({ auth: "admin" }, handleGET);

export const PATCH = withApi({ auth: "admin" }, async req => {
  const actor = await authenticate(req);
  const body = await req.json();
  if (typeof body.workerId !== "string" || typeof body.upiId !== "string" || typeof body.verified !== "boolean") throw new ApiError(400, "Worker, UPI ID and verification decision are required.");
  const userId = await resolveWorkerUserId(body.workerId);
  const { data, error } = await supabaseAdmin().rpc("verify_upi_config", { p_actor: actor.user.id, p_worker: userId, p_upi: body.upiId, p_verified: body.verified });
  databaseError(error);
  return json(200, { ok: true, upiConfig: data });
});
