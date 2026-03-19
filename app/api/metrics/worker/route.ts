import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

async function resolveWorkerAliases(workerId: string) {
  const sb = supabaseAdmin();
  const aliases = new Set<string>([workerId].filter(Boolean));

  const byCode = await sb.from("profiles").select("id,worker_code").eq("worker_code", workerId).maybeSingle();
  if (byCode.data?.id) aliases.add(String(byCode.data.id));
  if ((byCode.data as any)?.worker_code) aliases.add(String((byCode.data as any).worker_code));

  const byId = await sb.from("profiles").select("id,worker_code").eq("id", workerId).maybeSingle();
  if (byId.data?.id) aliases.add(String(byId.data.id));
  if ((byId.data as any)?.worker_code) aliases.add(String((byId.data as any).worker_code));

  const workerRow = await sb.from("workers").select("id,user_id").or(`id.eq.${workerId},user_id.eq.${workerId}`).maybeSingle();
  if (workerRow.data?.id) aliases.add(String(workerRow.data.id));
  if ((workerRow.data as any)?.user_id) aliases.add(String((workerRow.data as any).user_id));

  return Array.from(aliases).filter(Boolean);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workerId = url.searchParams.get("workerId");
  if (!workerId) return NextResponse.json({ error: "workerId required" }, { status: 400, headers: NO_STORE_HEADERS });

  const workerAliases = await resolveWorkerAliases(workerId);

  const { data, error } = await supabaseAdmin()
    .from("work_items")
    .select("status,reward_inr,started_at,completed_at,due_at,sla_minutes")
    .or(workerAliases.map((id) => `worker_id.eq.${id}`).join(","));

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });

  const items = data ?? [];
  const approved = items.filter((x) => x.status === "Approved");
  const submitted = items.filter((x) => x.status === "Submitted");
  const inProg = items.filter((x) => x.status === "In progress");

  const earnings = approved.reduce((s, x) => s + (x.reward_inr ?? 0), 0);
  const pending = submitted.reduce((s, x) => s + (x.reward_inr ?? 0), 0);

  // SLA: count breaches where started_at exists and duration > sla_minutes
  let slaBreaches = 0;
  let slaMet = 0;
  for (const x of items) {
    if (!x.started_at) continue;
    const start = new Date(x.started_at).getTime();
    const end = x.completed_at ? new Date(x.completed_at).getTime() : Date.now();
    const mins = Math.floor((end - start) / 60000);
    if (typeof x.sla_minutes === "number") {
      if (mins > x.sla_minutes && x.status === "Approved") slaBreaches++;
      if (mins <= x.sla_minutes && x.status === "Approved") slaMet++;
    }
  }

  return NextResponse.json({
    counts: {
      total: items.length,
      approved: approved.length,
      submitted: submitted.length,
      inProgress: inProg.length,
    },
    money: { earnings, pending },
    sla: { met: slaMet, breached: slaBreaches },
  }, { headers: NO_STORE_HEADERS });
}
