// app/api/admin/create-worker/route.ts
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  const workerId = String(body?.workerId ?? "").trim();
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const active = body?.active === undefined ? true : !!body?.active;

  if (!workerId || !name || !email || password.length < 6) {
    return json(400, { ok: false, error: "Missing fields" });
  }

  const isMissingColumn = (msg?: string | null) => {
    if (!msg) return false;
    return (
      (msg.includes("column") && msg.includes("does not exist")) ||
      (msg.includes("Could not find the") && msg.includes("column")) ||
      msg.includes("schema cache")
    );
  };
  const isMissingTable = (msg?: string | null) => !!msg && msg.includes("does not exist");

  // 1) Create Auth user (profile will be created by trigger handle_new_user)
  const created = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: "Worker", worker_code: workerId, display_name: name },
  });

  if (created.error || !created.data.user) {
    return json(500, { ok: false, error: created.error?.message || "Failed to create user" });
  }

  const authUserId = created.data.user.id;

  // 2) Ensure profile exists + set active
  // Trigger should have inserted it; but we’ll upsert safely in case of edge delay.
  let upsertProfile = await sb
    .from("profiles")
    .upsert({ id: authUserId, role: "Worker", display_name: name, email, active }, { onConflict: "id" })
    .select("worker_code, display_name, email, active")
    .single();
  if (upsertProfile.error) {
    upsertProfile = await sb
      .from("profiles")
      .upsert({ id: authUserId, role: "Worker", display_name: name }, { onConflict: "id" })
      .select("worker_code, display_name")
      .single();
  }
  if (!upsertProfile.error) {
    const updateRes = await sb.from("profiles").update({ worker_code: workerId }).eq("id", authUserId).select("worker_code").single();
    if (!updateRes.error) {
      upsertProfile = { ...upsertProfile, data: { ...(upsertProfile.data as any), worker_code: updateRes.data.worker_code } } as any;
    }
  }
  if (upsertProfile.error && isMissingColumn(upsertProfile.error.message)) {
    upsertProfile = await sb
      .from("profiles")
      .upsert(
        { id: authUserId, role: "Worker", display_name: name, worker_code: workerId },
        { onConflict: "id" }
      )
      .select("worker_code, display_name")
      .single();
  }
  if (upsertProfile.error && isMissingColumn(upsertProfile.error.message)) {
    upsertProfile = await sb
      .from("profiles")
      .upsert({ id: authUserId, role: "Worker", display_name: name }, { onConflict: "id" })
      .select("display_name")
      .single();
  }

  if (upsertProfile.error || !upsertProfile.data) {
    await sb.auth.admin.deleteUser(authUserId).catch(() => null);
    return json(500, { ok: false, error: upsertProfile.error?.message || "Failed to create profile" });
  }

  let workersInsert: any = await sb
    .from("workers")
    .insert({ id: workerId, user_id: authUserId, name, email, active })
    .select("id,name,email,active")
    .single();
  if (workersInsert.error && isMissingColumn(workersInsert.error.message)) {
    workersInsert = await sb
      .from("workers")
      .insert({ id: workerId, user_id: authUserId, name, active })
      .select("id,name,active")
      .single();
  }
  if (workersInsert.error && isMissingTable(workersInsert.error.message)) {
    workersInsert = { data: null, error: null };
  }

  return json(200, {
    ok: true,
    worker: {
      id: String((upsertProfile.data as any).worker_code ?? workerId),
      name: String((upsertProfile.data as any).display_name ?? name),
      email: String((upsertProfile.data as any).email ?? workersInsert.data?.email ?? email),
      active: (upsertProfile.data as any).active ?? workersInsert.data?.active ?? active,
    },
  });
}
