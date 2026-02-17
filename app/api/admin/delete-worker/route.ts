import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

type DeleteTask = {
  table: string;
  column: string;
  value: string;
};

type WorkerLookupRow = {
  id?: string | null;
  user_id?: string | null;
};

type ProfileLookupRow = {
  id?: string | null;
  worker_code?: string | null;
};

function isIgnorableError(message?: string | null) {
  const m = String(message ?? "").toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find the table") ||
    m.includes("column") ||
    m.includes("invalid input syntax") ||
    m.includes("no rows")
  );
}

async function runDeleteTasks(sb: ReturnType<typeof supabaseAdmin>, tasks: DeleteTask[]) {
  const errors: string[] = [];
  for (const task of tasks) {
    if (!task.value) continue;
    const { error } = await sb.from(task.table).delete().eq(task.column, task.value);
    if (error && !isIgnorableError(error.message)) {
      errors.push(`${task.table}.${task.column}: ${error.message}`);
    }
  }
  return errors;
}

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const workerIdInput = String(body?.workerId ?? "").trim();
  if (!workerIdInput) return json(400, { ok: false, error: "workerId is required." });

  let authUserId = "";
  let workerCode = "";

  const workersById = await sb.from("workers").select("id,user_id").eq("id", workerIdInput).maybeSingle();
  if (!workersById.error && workersById.data) {
    const row = workersById.data as WorkerLookupRow;
    workerCode = String(row.id ?? "");
    authUserId = String(row.user_id ?? "");
  }

  if (!authUserId) {
    const workersByUser = await sb.from("workers").select("id,user_id").eq("user_id", workerIdInput).maybeSingle();
    if (!workersByUser.error && workersByUser.data) {
      const row = workersByUser.data as WorkerLookupRow;
      workerCode = String(row.id ?? "");
      authUserId = String(row.user_id ?? "");
    }
  }

  if (!authUserId) {
    const profileByCode = await sb.from("profiles").select("id,worker_code").eq("worker_code", workerIdInput).maybeSingle();
    if (!profileByCode.error && profileByCode.data) {
      const row = profileByCode.data as ProfileLookupRow;
      authUserId = String(row.id ?? "");
      workerCode = String(row.worker_code ?? workerIdInput);
    }
  }

  if (!authUserId) {
    const profileById = await sb.from("profiles").select("id,worker_code").eq("id", workerIdInput).maybeSingle();
    if (!profileById.error && profileById.data) {
      const row = profileById.data as ProfileLookupRow;
      authUserId = String(row.id ?? "");
      workerCode = String(row.worker_code ?? "");
    }
  }

  if (!authUserId && !workerCode) {
    return json(404, { ok: false, error: "Worker not found." });
  }

  const keys = Array.from(new Set([workerIdInput, workerCode, authUserId].filter(Boolean)));

  const tasks: DeleteTask[] = [];
  for (const key of keys) {
    tasks.push(
      { table: "worker_account_assignments", column: "worker_id", value: key },
      { table: "worker_accounts", column: "worker_id", value: key },
      { table: "assignments", column: "worker_id", value: key },
      { table: "assignments", column: "workerId", value: key },
      { table: "work_items", column: "worker_id", value: key },
      { table: "work_items", column: "workerId", value: key },
      { table: "upi_configs", column: "worker_id", value: key },
      { table: "payout_batches", column: "worker_id", value: key },
      { table: "gig_assignments", column: "worker_code", value: key },
      { table: "worker_kyc", column: "worker_id", value: key },
      { table: "worker_kyc", column: "user_id", value: key }
    );
  }
  if (authUserId) {
    tasks.push({ table: "work_email_accounts", column: "owner_user_id", value: authUserId });
  }

  const errors = await runDeleteTasks(sb, tasks);

  if (workerCode) {
    const wErr = await sb.from("workers").delete().eq("id", workerCode);
    if (wErr.error && !isIgnorableError(wErr.error.message)) errors.push(`workers.id: ${wErr.error.message}`);
  }
  if (authUserId) {
    const wErr = await sb.from("workers").delete().eq("user_id", authUserId);
    if (wErr.error && !isIgnorableError(wErr.error.message)) errors.push(`workers.user_id: ${wErr.error.message}`);

    const pErr = await sb.from("profiles").delete().eq("id", authUserId);
    if (pErr.error && !isIgnorableError(pErr.error.message)) errors.push(`profiles.id: ${pErr.error.message}`);

    const authDel = await sb.auth.admin.deleteUser(authUserId);
    if (authDel.error && !isIgnorableError(authDel.error.message)) errors.push(`auth.deleteUser: ${authDel.error.message}`);
  }

  if (errors.length > 0) {
    return json(500, { ok: false, error: errors[0], details: errors });
  }

  return json(200, { ok: true, workerId: workerIdInput });
}
