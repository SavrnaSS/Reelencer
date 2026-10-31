import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { resolveWorkerUserId } from "@/lib/api/work";
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";
import { getDevAdminUpiConfigs } from "../_devData";
import { loadAdminPendingUpiQueue } from "@/lib/adminUpiQueue";

async function handleGET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  const params = new URL(req.url).searchParams;
  const pending = params.get("status") === "pending";
  if (params.has("status") && !pending) throw new ApiError(400, "Choose a valid UPI verification status.", "invalid_input");
  const rawLimit = params.get("limit") ?? "5";
  if (pending && !/^(?:[1-9]|1\d|20)$/.test(rawLimit)) throw new ApiError(400, "Choose a queue limit between 1 and 20.", "invalid_input");
  const limit = Number(rawLimit);
  if (guard.devBypass) {
    const configs = getDevAdminUpiConfigs();
    const pendingConfigs = configs.filter(config => !config.verified);
    return json(200, pending
      ? { ok: true, pendingCount: pendingConfigs.length, upiConfigs: pendingConfigs.slice(0, limit).map(config => ({ ...config, workerName: config.workerCode })) }
      : { ok: true, upiConfigs: configs });
  }

  const sb = supabaseAdmin();
  if (pending) return json(200, { ok: true, ...await loadAdminPendingUpiQueue(sb, limit) });
  const upiRes = await sb
    .from("upi_configs")
    .select("worker_id,upi_id,method,bank_holder_name,verified,verified_at,updated_at,payout_schedule,payout_day");
  if (upiRes.error) return json(500, { ok: false, error: upiRes.error.message });

  const workerIds = Array.from(new Set((upiRes.data ?? []).map((u) => String(u.worker_id ?? "")).filter(Boolean)));
  const profilesRes = workerIds.length
    ? await sb.from("profiles").select("id,worker_code,display_name").in("id", workerIds)
    : { data: [] };
  databaseError("error" in profilesRes ? profilesRes.error : null);
  const profileById = new Map((profilesRes.data ?? []).map(p => [String(p.id), p]));

  return json(200, {
    ok: true,
    upiConfigs: (upiRes.data ?? []).map((u) => ({
      workerId: String(u.worker_id ?? ""),
      workerCode: profileById.get(String(u.worker_id ?? ""))?.worker_code ?? undefined,
      workerName: profileById.get(String(u.worker_id ?? ""))?.display_name ?? undefined,
      // The destination key: a UPI ID or bank:<IFSC>:<account number> (the team needs the full details to pay).
      upiId: String(u.upi_id ?? ""),
      method: u.method === "Bank" ? "Bank" : "UPI",
      bankHolderName: u.bank_holder_name ?? undefined,
      verified: !!u.verified,
      verifiedAt: u.verified_at ?? undefined,
      updatedAt: u.updated_at ?? undefined,
      payoutSchedule: u.payout_schedule ?? undefined,
      payoutDay: u.payout_day ?? undefined,
    })),
  });
}

export const GET = withApi({ auth: "admin" }, handleGET);

export const PATCH = withApi({ auth: "admin" }, async req => {
  const actor = await authenticate(req);
  const body = await req.json();
  if (typeof body.workerId !== "string" || typeof body.upiId !== "string" || typeof body.verified !== "boolean") throw new ApiError(400, "Worker, payout destination and verification decision are required.");
  const userId = await resolveWorkerUserId(body.workerId);
  const { data, error } = await supabaseAdmin().rpc("verify_upi_config", { p_actor: actor.user.id, p_worker: userId, p_upi: body.upiId, p_verified: body.verified });
  databaseError(error);
  return json(200, { ok: true, upiConfig: data });
});
