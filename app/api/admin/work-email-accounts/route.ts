import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

type WorkEmailAccountRow = {
  id: string;
  owner_user_id?: string | null;
  email?: string | null;
  username?: string | null;
  social_password?: string | null;
  platform?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ProfileRow = {
  id: string;
  display_name?: string | null;
  worker_code?: string | null;
  role?: string | null;
};

function missingSchema(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("relation") ||
    lower.includes("undefined table") ||
    lower.includes("schema cache") ||
    lower.includes("could not find the table") ||
    lower.includes("column")
  );
}

export async function GET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("work_email_accounts")
    .select("id,owner_user_id,email,username,social_password,platform,status,created_at,updated_at")
    .neq("status", "deleted")
    .order("created_at", { ascending: false });

  if (error) {
    if (missingSchema(error.message)) return json(200, { ok: true, accounts: [], missingSchema: true });
    return json(500, { ok: false, error: error.message });
  }

  const ownerIds = Array.from(new Set((data ?? []).map((row: WorkEmailAccountRow) => String(row.owner_user_id || "")).filter(Boolean)));
  const profiles = ownerIds.length
    ? await sb.from("profiles").select("id,display_name,worker_code,role").in("id", ownerIds)
    : { data: [] as ProfileRow[] };
  const ownerById = new Map(
    (profiles.data ?? []).map((p: ProfileRow) => [
      String(p.id),
      {
        displayName: String(p.display_name ?? ""),
        workerCode: String(p.worker_code ?? ""),
        role: String(p.role ?? ""),
      },
    ])
  );

  const rows = (data ?? []).map((row: WorkEmailAccountRow) => {
    const owner = ownerById.get(String(row.owner_user_id ?? ""));
    return {
      id: String(row.id),
      ownerUserId: String(row.owner_user_id ?? ""),
      ownerDisplayName: owner?.displayName || "",
      ownerWorkerCode: owner?.workerCode || "",
      ownerRole: owner?.role || "",
      email: String(row.email ?? ""),
      username: String(row.username ?? ""),
      hasSocialPassword: !!row.social_password,
      platform: String(row.platform ?? ""),
      status: String(row.status ?? ""),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return json(200, { ok: true, accounts: rows });
}
