import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function parsePayoutAmount(raw: unknown) {
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const normalized = text.replace(/[, ]+/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function buildApprovalWorkItemId(assignmentId: string) {
  const compact = String(assignmentId ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `GIGCRED-${compact.slice(0, 18) || "ITEM"}`;
}

function isMissingColumn(msg?: string | null) {
  if (!msg) return false;
  return (
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("Could not find the") && msg.includes("column")) ||
    msg.includes("schema cache")
  );
}

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

  const sb = supabaseAdmin();
  let workItemsRes: { data: any[] | null; error: { message: string } | null } = await sb
    .from("work_items")
    .select("public_id,status,reward_inr,started_at,completed_at,due_at,sla_minutes,review")
    .or(workerAliases.map((id) => `worker_id.eq.${id}`).join(","));
  if (workItemsRes.error && isMissingColumn(workItemsRes.error.message)) {
    workItemsRes = await sb
      .from("work_items")
      .select("public_id,status,reward_inr,started_at,completed_at,due_at,sla_minutes")
      .or(workerAliases.map((id) => `worker_id.eq.${id}`).join(","));
  }

  if (workItemsRes.error) return NextResponse.json({ error: workItemsRes.error.message }, { status: 500, headers: NO_STORE_HEADERS });

  const items = workItemsRes.data ?? [];
  const operationalItems = items.filter((x: any) => String(x?.review?.source ?? "") !== "gig_assignment_approval");
  const approved = operationalItems.filter((x) => x.status === "Approved");
  const submitted = operationalItems.filter((x) => x.status === "Submitted");
  const inProg = operationalItems.filter((x) => x.status === "In progress");

  const workerCodeAliases = workerAliases.filter((id) => id.startsWith("WKR-"));
  const credentialAssignmentsRes = workerCodeAliases.length
    ? await supabaseAdmin()
        .from("gig_assignments")
        .select("id,gig_id,status")
        .in("worker_code", workerCodeAliases)
    : { data: [], error: null as any };
  if (credentialAssignmentsRes.error) {
    return NextResponse.json({ error: credentialAssignmentsRes.error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }

  const credentialAssignments = credentialAssignmentsRes.data ?? [];
  const credentialGigIds = Array.from(new Set(credentialAssignments.map((row: any) => String(row.gig_id)).filter(Boolean)));
  const credentialGigsRes = credentialGigIds.length
    ? await supabaseAdmin().from("gigs").select("id,payout").in("id", credentialGigIds)
    : { data: [], error: null as any };
  if (credentialGigsRes.error) {
    return NextResponse.json({ error: credentialGigsRes.error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
  const payoutByGigId = new Map<string, number>(
    (credentialGigsRes.data ?? []).map((gig: any) => [String(gig.id), parsePayoutAmount(gig.payout)])
  );

  const credentialPublicIds = credentialAssignments.map((row: any) => buildApprovalWorkItemId(String(row.id)));
  const credentialWorkItemsRes = credentialPublicIds.length
    ? await sb.from("work_items").select("public_id,status").in("public_id", credentialPublicIds)
    : { data: [], error: null as any };
  if (credentialWorkItemsRes.error) {
    return NextResponse.json({ error: credentialWorkItemsRes.error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
  const credentialWorkItemByPublicId = new Map<string, { status?: string }>(
    (credentialWorkItemsRes.data ?? []).map((row: any) => [String(row.public_id), row])
  );

  let credentialApprovedCount = 0;
  let credentialSubmittedCount = 0;
  let credentialApprovedEarnings = 0;
  let credentialPendingEarnings = 0;
  for (const assignment of credentialAssignments) {
    const publicId = buildApprovalWorkItemId(String((assignment as any).id));
    const workItem = credentialWorkItemByPublicId.get(publicId);
    const amount = payoutByGigId.get(String((assignment as any).gig_id)) ?? 0;
    const workStatus = String(workItem?.status ?? "");
    if (workStatus === "Approved") {
      credentialApprovedCount += 1;
      credentialApprovedEarnings += amount;
      continue;
    }
    if (
      ["Submitted", "Accepted", "Pending"].includes(String((assignment as any).status ?? "")) ||
      workStatus === "Submitted"
    ) {
      credentialSubmittedCount += 1;
      credentialPendingEarnings += amount;
    }
  }

  const earnings = approved.reduce((s, x) => s + (x.reward_inr ?? 0), 0) + credentialApprovedEarnings;
  const pending = submitted.reduce((s, x) => s + (x.reward_inr ?? 0), 0) + credentialPendingEarnings;

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
      total: operationalItems.length + credentialAssignments.length,
      approved: approved.length + credentialApprovedCount,
      submitted: submitted.length + credentialSubmittedCount,
      inProgress: inProg.length,
    },
    money: { earnings, pending },
    sla: { met: slaMet, breached: slaBreaches },
  }, { headers: NO_STORE_HEADERS });
}
