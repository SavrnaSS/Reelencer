import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type AssignedAccount = {
  id: string;
  handle: string;
  niche: string;
  ownerTeam: string;
  policyTier: string;
  health: string;
  rules: string[];
  allowedAudios: string[];
  requiredHashtags: string[];
};
type AssignmentSchedule = {
  times?: string[];
  days?: number[];
  deadlineMin?: number;
  timezone?: string;
};

function normId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET() {
  const sb = supabaseAdmin();
  const workersRes = await sb.from("workers").select("id,name,email,active,user_id").order("id");
  if (workersRes.error && !workersRes.error.message.includes("column")) {
    return NextResponse.json({ error: workersRes.error.message }, { status: 500 });
  }

  let workers = workersRes.data ?? [];
  if (workersRes.error || workers.length === 0) {
    const profilesRes = await sb
      .from("profiles")
      .select("id,role,display_name,worker_code,created_at")
      .eq("role", "Worker")
      .order("created_at", { ascending: false });
    if (!profilesRes.error && Array.isArray(profilesRes.data)) {
      workers = profilesRes.data.map((p) => ({
        id: String(p.worker_code ?? p.id),
        name: String(p.display_name ?? "Worker"),
        email: "",
        active: true,
        user_id: String(p.id),
      }));
    }
  }

  const workerIdByUserId = new Map<string, string>();
  for (const w of workersRes.data ?? []) {
    const userId = (w as any).user_id;
    if (userId) workerIdByUserId.set(String(userId), String((w as any).id));
  }

  const workerUserIds = Array.from(new Set((workersRes.data ?? []).map((w: any) => String(w.user_id ?? "")).filter(Boolean)));
  const profilesForWorkers = workerUserIds.length
    ? await sb.from("profiles").select("id,worker_code").in("id", workerUserIds)
    : { data: [] as any[], error: null as any };
  const workerCodeByUserId = new Map<string, string>(
    (profilesForWorkers.data ?? []).map((p: any) => [String(p.id), String(p.worker_code ?? p.id)])
  );

  const assignmentsRows: Array<{ workerId: string; accountId: string; schedule?: AssignmentSchedule }> = [];
  const asg1 = await sb
    .from("assignments")
    .select("workerId,accountId,worker_id,account_id,schedule,schedule_morning,schedule_evening,deadline_minutes,schedule_days,schedule_timezone");
  if (!asg1.error) {
    for (const as of asg1.data ?? []) {
      assignmentsRows.push({
        workerId: String((as as any).workerId ?? (as as any).worker_id ?? ""),
        accountId: String((as as any).accountId ?? (as as any).account_id ?? ""),
        schedule: (as as any).schedule ?? undefined,
      });
    }
  }
  const asg2 = await sb
    .from("worker_account_assignments")
    .select("worker_id,account_id,schedule,schedule_morning,schedule_evening,deadline_minutes,schedule_days,schedule_timezone");
  if (!asg2.error) {
    for (const as of asg2.data ?? []) {
      assignmentsRows.push({
        workerId: String((as as any).worker_id ?? ""),
        accountId: String((as as any).account_id ?? ""),
        schedule: (as as any).schedule ?? undefined,
      });
    }
  }
  const asg3 = await sb.from("worker_accounts").select("worker_id,account_id");
  if (!asg3.error) {
    for (const as of asg3.data ?? []) {
      assignmentsRows.push({ workerId: String((as as any).worker_id ?? ""), accountId: String((as as any).account_id ?? "") });
    }
  }

  const uniqueAssignments = new Map<string, { workerId: string; accountId: string; schedule?: AssignmentSchedule }>();
  for (const as of assignmentsRows) {
    if (!as.workerId || !as.accountId) continue;
    uniqueAssignments.set(`${as.workerId}::${as.accountId}`, as);
  }

  const assignmentRows = Array.from(uniqueAssignments.values());
  const assignmentWorkerIds = Array.from(new Set(assignmentRows.map((a) => a.workerId)));
  const profilesRes = assignmentWorkerIds.length
    ? await sb.from("profiles").select("id,worker_code").in("id", assignmentWorkerIds)
    : { data: [] as any[], error: null as any };
  const codeById = new Map<string, string>((profilesRes.data ?? []).map((p: any) => [String(p.id), String(p.worker_code ?? p.id)]));

  const assignments = assignmentRows.map((as) => ({
    workerId: workerIdByUserId.get(as.workerId) ?? codeById.get(as.workerId) ?? as.workerId,
    accountId: as.accountId,
    schedule: as.schedule ?? undefined,
  }));

  const accountIds = Array.from(new Set(assignments.map((a) => a.accountId).filter(Boolean)));
  const accountsRes = accountIds.length ? await sb.from("accounts").select("*").in("id", accountIds) : { data: [] as any[], error: null };
  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 500 });

  const accountsById = new Map<string, AssignedAccount>();
  for (const a of accountsRes.data ?? []) {
    accountsById.set(String(a.id), {
      id: String(a.id),
      handle: String(a.handle ?? ""),
      niche: String(a.niche ?? ""),
      ownerTeam: String(a.ownerTeam ?? a.owner_team ?? ""),
      policyTier: String(a.policyTier ?? a.policy_tier ?? "Standard"),
      health: String(a.health ?? "Healthy"),
      rules: Array.isArray(a.rules) ? a.rules : [],
      allowedAudios: Array.isArray(a.allowedAudios ?? a.allowed_audios) ? (a.allowedAudios ?? a.allowed_audios) : [],
      requiredHashtags: Array.isArray(a.requiredHashtags ?? a.required_hashtags) ? (a.requiredHashtags ?? a.required_hashtags) : [],
    });
  }

  return NextResponse.json(
    workers.map((w: any) => {
      const userId = String(w.user_id ?? "");
      const workerId = workerCodeByUserId.get(userId) ?? String(w.id);
      const aliases = new Set(
        [workerId, userId, String(w.id), workerIdByUserId.get(userId), workerCodeByUserId.get(userId)]
          .map((v) => normId(v))
          .filter(Boolean)
      );
      let assignedAccountIds = assignments
        .filter((a) => aliases.has(normId(a.workerId)))
        .map((a) => a.accountId);
      assignedAccountIds = Array.from(new Set(assignedAccountIds.filter(Boolean)));

      const assignedAccounts = assignedAccountIds.map((id) => accountsById.get(id)).filter(Boolean) as AssignedAccount[];
      const assignedAccountSchedules: Record<string, AssignmentSchedule> = {};
      for (const asg of assignments.filter((a) => aliases.has(normId(a.workerId)))) {
        if (!asg.accountId) continue;
        if (asg.schedule) assignedAccountSchedules[asg.accountId] = asg.schedule;
      }
      return {
        id: workerId,
        workerId,
        userId: userId || undefined,
        name: String(w.name ?? ""),
        email: String(w.email ?? ""),
        active: w.active === undefined ? true : !!w.active,
        assignedAccountIds,
        assignedAccounts,
        assignedAccountSchedules,
      };
    })
  );
}
