import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const IST_OFFSET_MIN = 330;

const isMissingColumn = (msg?: string | null) => {
  if (!msg) return false;
  return (
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("Could not find the") && msg.includes("column")) ||
    msg.includes("schema cache")
  );
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const toIstLocal = (d: Date) => {
  const shifted = new Date(d.getTime() + IST_OFFSET_MIN * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = pad2(shifted.getUTCMonth() + 1);
  const day = pad2(shifted.getUTCDate());
  const hh = pad2(shifted.getUTCHours());
  const mm = pad2(shifted.getUTCMinutes());
  return `${y}-${m}-${day}T${hh}:${mm}`;
};
const parseIstLocalToUtc = (s: string) => {
  const [datePart, timePart] = s.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0) - IST_OFFSET_MIN * 60 * 1000);
};
const parseDueToUtc = (s: string) => {
  if (s.includes("Z") || s.includes("+") || s.includes("-")) {
    const asUtc = new Date(s);
    return Number.isNaN(asUtc.getTime()) ? parseIstLocalToUtc(s) : asUtc;
  }
  return parseIstLocalToUtc(s);
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  let id = decodeURIComponent(resolvedParams.id);
  if (!id || id === "undefined") {
    const body = await req.json().catch(() => ({}));
    const fallback = String(body?.id ?? body?.workItemId ?? "");
    if (fallback && fallback !== "undefined") {
      id = fallback;
    }
  }
  if (!id || id === "undefined") return NextResponse.json({ error: "Invalid work item id" }, { status: 400 });
  const now = new Date();
  const sb = supabaseAdmin();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

  // only update if currently Open
  let { data: item, error: readErr } = await sb
    .from("work_items")
    .select("*")
    .or(isUuid ? `id.eq.${id},public_id.eq.${id}` : `public_id.eq.${id}`)
    .maybeSingle();
  if (readErr && isMissingColumn(readErr.message)) {
    ({ data: item, error: readErr } = await sb
      .from("work_items")
      .select("*")
      .eq(isUuid ? "id" : "public_id", id)
      .maybeSingle());
  }
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.status !== "Open") return NextResponse.json(item); // no-op

  const audit = [
    { at: now.toISOString().slice(0, 16).replace("T", " "), by: "Worker", text: "Marked as In progress." },
    ...(item.audit ?? []),
  ];

  let update = await sb
    .from("work_items")
    .update({ status: "In progress", started_at: now.toISOString(), audit })
    .eq(item.id ? "id" : "public_id", item.id ?? id)
    .select("*")
    .single();
  if (update.error && isMissingColumn(update.error.message)) {
    update = await sb
      .from("work_items")
      .update({ status: "In progress", startedAt: now.toISOString(), audit })
      .eq(item.id ? "id" : "public_id", item.id ?? id)
      .select("*")
      .single();
  }
  if (update.error && isMissingColumn(update.error.message)) {
    update = await sb
      .from("work_items")
      .update({ status: "In progress", started_at: now.toISOString() })
      .eq(item.id ? "id" : "public_id", item.id ?? id)
      .select("*")
      .single();
  }
  if (update.error && isMissingColumn(update.error.message)) {
    update = await sb
      .from("work_items")
      .update({ status: "In progress", startedAt: now.toISOString() })
      .eq(item.id ? "id" : "public_id", item.id ?? id)
      .select("*")
      .single();
  }

  if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
  const data = update.data;

  const dueRaw = data.due_at ?? data.dueAt;
  const dueUtc = dueRaw ? parseDueToUtc(String(dueRaw)) : null;
  const startedRaw = data.started_at ?? data.startedAt;
  const completedRaw = data.completed_at ?? data.completedAt;

  // Return in the exact frontend format
  return NextResponse.json({
    id: data.id ?? data.public_id ?? id,
    title: data.title,
    type: data.type,
    accountId: data.account_id ?? data.accountId,
    createdAt: data.created_at ?? data.createdAt,
    dueAt: dueUtc ? toIstLocal(dueUtc) : undefined,
    status: data.status,
    priority: data.priority,
    rewardINR: data.reward_inr ?? data.rewardINR,
    estMinutes: data.est_minutes ?? data.estMinutes,
    slaMinutes: data.sla_minutes ?? data.slaMinutes,
    startedAt: startedRaw ? toIstLocal(new Date(startedRaw)) : undefined,
    completedAt: completedRaw ? toIstLocal(new Date(completedRaw)) : undefined,
    gates: data.gates ?? {},
    submission: data.submission ?? undefined,
    review: data.review ?? undefined,
    audit: data.audit ?? [],
  });
}
