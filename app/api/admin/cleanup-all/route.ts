import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

const isMissingColumn = (msg?: string | null) => {
  if (!msg) return false;
  return (
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("Could not find the") && msg.includes("column")) ||
    msg.includes("schema cache")
  );
};

async function pruneExtraOpenItems(sb: ReturnType<typeof supabaseAdmin>, rows: any[], useCamel: boolean) {
  const openRows = rows.filter((x) => String(x.status ?? "").toLowerCase() === "open");
  if (openRows.length <= 2) return { deleted: 0 };

  const sorted = [...openRows].sort((a, b) => {
    const da = new Date(useCamel ? a.dueAt : a.due_at).toISOString();
    const db = new Date(useCamel ? b.dueAt : b.due_at).toISOString();
    return da.localeCompare(db);
  });
  const extra = sorted.slice(2);
  const ids = extra.map((x) => x.id).filter(Boolean);
  let deleted = 0;
  if (ids.length) {
    let del = await sb.from("work_items").delete().in("id", ids);
    if (del.error && isMissingColumn(del.error.message)) {
      const pubIds = extra.map((x) => x.public_id).filter(Boolean);
      if (pubIds.length) {
        del = await sb.from("work_items").delete().in("public_id", pubIds);
      }
    }
    if (!del.error) deleted = extra.length;
  }
  return { deleted };
}

async function cleanupAccountWorkItems(sb: ReturnType<typeof supabaseAdmin>, accountId: string) {
  const rows: any[] = [];
  let useCamel = false;

  const both = await sb
    .from("work_items")
    .select("id,public_id,due_at,dueAt,status,account_id,accountId")
    .or(`account_id.eq.${accountId},accountId.eq.${accountId}`)
    .order("due_at", { ascending: true });
  if (!both.error && Array.isArray(both.data)) {
    rows.push(...both.data);
    useCamel = (both.data ?? []).some((x: any) => x.dueAt);
  }
  if (both.error && isMissingColumn(both.error.message)) {
    const snake = await sb
      .from("work_items")
      .select("id,public_id,due_at,status,account_id")
      .eq("account_id", accountId)
      .order("due_at", { ascending: true });
    if (!snake.error && Array.isArray(snake.data)) rows.push(...snake.data);

    const camel = await sb
      .from("work_items")
      .select("id,public_id,dueAt,status,accountId")
      .eq("accountId", accountId)
      .order("dueAt", { ascending: true });
    if (!camel.error && Array.isArray(camel.data)) {
      rows.push(...camel.data);
      useCamel = true;
    }
  }

  if (!rows.length) return { deleted: 0 };
  return await pruneExtraOpenItems(sb, rows, useCamel);
}

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const accountsRes = await sb.from("accounts").select("id");
  if (accountsRes.error) return json(500, { ok: false, error: accountsRes.error.message });

  let deleted = 0;
  for (const a of accountsRes.data ?? []) {
    const res = await cleanupAccountWorkItems(sb, String((a as any).id ?? ""));
    deleted += res.deleted;
  }

  return json(200, { ok: true, deleted });
}
