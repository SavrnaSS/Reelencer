import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

export async function GET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const users: any[] = [];
  const perPage = 200;
  let page = 1;
  while (true) {
    const res = await sb.auth.admin.listUsers({ page, perPage });
    if (res.error) return json(500, { ok: false, error: res.error.message });
    users.push(...(res.data?.users ?? []));
    const total = res.data?.total ?? users.length;
    if (users.length >= total || (res.data?.users?.length ?? 0) === 0) break;
    page += 1;
    if (page > 20) break;
  }

  let profilesRes = await sb.from("profiles").select("id,role,display_name,worker_code,timezone,created_at");
  if (profilesRes.error && profilesRes.error.message.includes("column")) {
    profilesRes = await sb.from("profiles").select("id,role,display_name,worker_code,created_at");
  }
  const profiles = Array.isArray(profilesRes.data) ? profilesRes.data : [];
  const profileById = new Map<string, any>(profiles.map((p: any) => [String(p.id), p]));

  const workers = users.map((u: any) => {
    const profile = profileById.get(String(u.id));
    const meta = u.user_metadata ?? {};
    const email = String(u.email ?? "");
    const nameFromMeta = meta.display_name || meta.full_name || meta.name || (email ? email.split("@")[0] : "");
    const bannedUntil = u.banned_until ? new Date(u.banned_until) : null;
    const active = !bannedUntil || Number.isNaN(bannedUntil.getTime()) || bannedUntil.getTime() <= Date.now();
    return {
      id: String(profile?.worker_code ?? u.id),
      userId: String(u.id),
      name: String(profile?.display_name ?? nameFromMeta ?? "Worker"),
      email,
      active,
      timezone: profile?.timezone ?? undefined,
    };
  });

  return json(200, { ok: true, workers });
}
