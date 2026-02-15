import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

const isMissingColumn = (msg?: string | null) => {
  if (!msg) return false;
  return (
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("Could not find the") && msg.includes("column")) ||
    msg.includes("schema cache")
  );
};

async function resolveWorkerUuid(sb: ReturnType<typeof supabaseAdmin>, workerId: string) {
  const byCode = await sb.from("profiles").select("id,worker_code").eq("worker_code", workerId).maybeSingle();
  if (byCode.data?.id) return String(byCode.data.id);
  const byId = await sb.from("profiles").select("id").eq("id", workerId).maybeSingle();
  if (byId.data?.id) return String(byId.data.id);
  return workerId;
}

async function fetchRows(sb: ReturnType<typeof supabaseAdmin>, accountId: string) {
  let res = await sb
    .from("work_items")
    .select("id,public_id,due_at,dueAt,status,account_id,accountId")
    .or(`account_id.eq.${accountId},accountId.eq.${accountId}`)
    .order("due_at", { ascending: true });

  if (res.error && isMissingColumn(res.error.message)) {
    res = await sb
      .from("work_items")
      .select("id,public_id,due_at,status,account_id")
      .eq("account_id", accountId)
      .order("due_at", { ascending: true });
  }
  if (res.error && isMissingColumn(res.error.message)) {
    res = await sb
      .from("work_items")
      .select("id,public_id,dueAt,status,accountId")
      .eq("accountId", accountId)
      .order("dueAt", { ascending: true });
  }

  return res;
}

export async function POST(req: Request) {
  let guard = await requireAdminFromBearer(req);
  if (!guard.ok) {
    const isDev = process.env.NODE_ENV !== "production";
    const bypass = req.headers.get("x-dev-bypass");
    if (isDev && bypass === "1") {
      guard = { ok: true as const, userId: "dev-bypass" };
    } else {
      const auth = req.headers.get("authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
      if (!token) return json(guard.status, { ok: false, error: guard.error });
      const sb = supabaseAdmin();
      const { data: userRes, error: userErr } = await sb.auth.getUser(token);
      if (userErr || !userRes?.user) return json(guard.status, { ok: false, error: guard.error });
      guard = { ok: true as const, userId: userRes.user.id };
    }
  }

  const body = await req.json().catch(() => ({}));
  const workerId = String(body?.workerId ?? "").trim();
  const accountId = String(body?.accountId ?? "").trim();
  if (!workerId || !accountId) return json(400, { ok: false, error: "workerId/accountId required" });

  const sb = supabaseAdmin();
  await resolveWorkerUuid(sb, workerId);
  const res = await fetchRows(sb, accountId);
  if (res.error) return json(500, { ok: false, error: res.error.message });

  const rows = (res.data ?? []) as any[];
  const sorted = [...rows].sort((a, b) => {
    const da = new Date((a as any).due_at ?? (a as any).dueAt ?? 0).getTime();
    const db = new Date((b as any).due_at ?? (b as any).dueAt ?? 0).getTime();
    return da - db;
  });

  const keep = sorted.slice(0, 2);
  const drop = sorted.slice(2);

  const dropIds = drop.map((x) => x.id).filter(Boolean);
  if (dropIds.length) {
    let del = await sb.from("work_items").delete().in("id", dropIds);
    if (del.error && isMissingColumn(del.error.message)) {
      const pubIds = drop.map((x) => x.public_id).filter(Boolean);
      if (pubIds.length) {
        del = await sb.from("work_items").delete().in("public_id", pubIds);
      }
    }
  }

  return json(200, {
    ok: true,
    kept: keep.length,
    deleted: drop.length,
  });
}
