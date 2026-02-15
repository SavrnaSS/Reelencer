import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

export async function GET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const upiRes = await sb
    .from("upi_configs")
    .select("worker_id,upi_id,verified,verified_at,payout_schedule,payout_day");
  if (upiRes.error) return json(500, { ok: false, error: upiRes.error.message });

  const workerIds = Array.from(new Set((upiRes.data ?? []).map((u: any) => String(u.worker_id ?? "")).filter(Boolean)));
  const profilesRes = workerIds.length
    ? await sb.from("profiles").select("id,worker_code").in("id", workerIds)
    : { data: [] as any[] };
  const codeById = new Map<string, string>((profilesRes.data ?? []).map((p: any) => [String(p.id), String(p.worker_code ?? p.id)]));

  return json(200, {
    ok: true,
    upiConfigs: (upiRes.data ?? []).map((u: any) => ({
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
