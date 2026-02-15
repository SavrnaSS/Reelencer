// app/api/admin/snapshot/route.ts
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

export async function GET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();

  let workersRes: any = await sb.from("workers").select("id,name,email,active,user_id,timezone").order("id", { ascending: true });
  if (workersRes.error && workersRes.error.message.includes("column")) {
    workersRes = await sb.from("workers").select("id,name,email,active").order("id", { ascending: true });
  }
  const accountsRes = await sb.from("accounts").select("*").order("id", { ascending: true });
  const upiRes = await sb
    .from("upi_configs")
    .select("worker_id,upi_id,verified,verified_at,payout_schedule,payout_day");

  const assignmentsRows: Array<{ workerId: string; accountId: string; schedule?: any }> = [];
  const assignmentErrors: Array<{ table: string; message: string }> = [];

  const asg1 = await sb
    .from("assignments")
    .select("workerId,accountId,worker_id,account_id,schedule,schedule_morning,schedule_evening,deadline_minutes,schedule_days,schedule_timezone");
  if (asg1.error) assignmentErrors.push({ table: "assignments", message: asg1.error.message });
  else {
    for (const as of asg1.data ?? []) {
      assignmentsRows.push({
        workerId: String((as as any).workerId ?? (as as any).worker_id ?? ""),
        accountId: String((as as any).accountId ?? (as as any).account_id ?? ""),
        schedule: (as as any).schedule ?? null,
      });
    }
  }

  const asg2 = await sb
    .from("worker_account_assignments")
    .select("worker_id,account_id,schedule,schedule_morning,schedule_evening,deadline_minutes,schedule_days,schedule_timezone");
  if (asg2.error) assignmentErrors.push({ table: "worker_account_assignments", message: asg2.error.message });
  else {
    for (const as of asg2.data ?? []) {
      assignmentsRows.push({
        workerId: String((as as any).worker_id ?? ""),
        accountId: String((as as any).account_id ?? ""),
        schedule: (as as any).schedule ?? null,
      });
    }
  }

  const asg3 = await sb.from("worker_accounts").select("worker_id,account_id");
  if (asg3.error) assignmentErrors.push({ table: "worker_accounts", message: asg3.error.message });
  else {
    for (const as of asg3.data ?? []) {
      assignmentsRows.push({ workerId: String((as as any).worker_id ?? ""), accountId: String((as as any).account_id ?? "") });
    }
  }

  let workItemsRes: any = await sb.from("work_items").select("*").order("createdAt", { ascending: false });
  if (workItemsRes.error) {
    workItemsRes = await sb.from("work_items").select("*").order("created_at", { ascending: false });
  }

  let workers = workersRes.data ?? [];
  if (workersRes.error || workers.length === 0) {
    const profilesRes = await sb
      .from("profiles")
      .select("id,role,display_name,worker_code,timezone,created_at")
      .eq("role", "Worker")
      .order("created_at", { ascending: false });
    if (!profilesRes.error && Array.isArray(profilesRes.data)) {
      workers = profilesRes.data.map((p) => ({
        id: String(p.worker_code ?? p.id),
        name: String(p.display_name ?? "Worker"),
        email: "",
        active: true,
        timezone: (p as any).timezone ?? undefined,
      }));
    }
  }

  const workerIdByUserId = new Map<string, string>();
  for (const w of workersRes.data ?? []) {
    const userId = (w as any).user_id;
    if (userId) workerIdByUserId.set(String(userId), String((w as any).id));
  }

  const accounts = (accountsRes.error ? [] : accountsRes.data ?? []).map((a: any) => ({
    id: String(a.id),
    handle: String(a.handle ?? ""),
    niche: String(a.niche ?? ""),
    ownerTeam: String(a.ownerTeam ?? a.owner_team ?? ""),
    policyTier: a.policyTier ?? a.policy_tier ?? "Standard",
    health: a.health ?? "Healthy",
    rules: Array.isArray(a.rules) ? a.rules : [],
    allowedAudios: Array.isArray(a.allowedAudios ?? a.allowed_audios) ? (a.allowedAudios ?? a.allowed_audios) : [],
    requiredHashtags: Array.isArray(a.requiredHashtags ?? a.required_hashtags) ? (a.requiredHashtags ?? a.required_hashtags) : [],
  }));

  const uniqueAssignments = new Map<string, { workerId: string; accountId: string }>();
  for (const as of assignmentsRows) {
    if (!as.workerId || !as.accountId) continue;
    uniqueAssignments.set(`${as.workerId}::${as.accountId}`, as);
  }
  const assignmentRows = Array.from(uniqueAssignments.values());

  const workerIds = Array.from(new Set(assignmentRows.map((as) => as.workerId).filter(Boolean)));
  const profilesRes = workerIds.length ? await sb.from("profiles").select("id,worker_code").in("id", workerIds) : { data: [] as any[] };
  const codeById = new Map<string, string>((profilesRes.data ?? []).map((p: any) => [String(p.id), String(p.worker_code ?? p.id)]));

  const normalizeSchedule = (row: any) => {
    const schedule = row?.schedule ?? {};
    const times = Array.isArray(schedule?.times) ? schedule.times : [];
    const days = Array.isArray(schedule?.days) ? schedule.days : [];
    const deadlineMin = Number(schedule?.deadlineMin ?? schedule?.deadlineMinutes ?? row?.deadline_minutes);
    const timezone = schedule?.timezone ?? row?.schedule_timezone ?? undefined;
    if (!times.length && !days.length && !deadlineMin && !timezone) return undefined;
    return {
      times,
      days,
      deadlineMin: Number.isFinite(deadlineMin) ? deadlineMin : undefined,
      timezone,
    };
  };

  const assignments = assignmentRows.map((as) => {
    const rawWorkerId = String(as.workerId ?? "");
    const workerCode = codeById.get(rawWorkerId) ?? workerIdByUserId.get(rawWorkerId) ?? rawWorkerId;
    return {
      workerId: workerCode,
      accountId: String(as.accountId ?? ""),
      schedule: normalizeSchedule(as),
    };
  });

  const workItems = (workItemsRes.error ? [] : workItemsRes.data ?? []).map((x: any) => ({
    id: String(x.id ?? x.public_id ?? ""),
    workerId: String(x.workerId ?? x.worker_id ?? ""),
    accountId: String(x.accountId ?? x.account_id ?? ""),
    title: String(x.title ?? ""),
    type: x.type ?? "Reel posting",
    createdAt: x.createdAt ?? x.created_at ?? "",
    dueAt: x.dueAt ?? (x.due_at ? new Date(x.due_at).toISOString().slice(0, 16) : ""),
    status: x.status ?? "Open",
    priority: x.priority ?? "P1",
    rewardINR: x.rewardINR ?? x.reward_inr ?? 0,
    estMinutes: x.estMinutes ?? x.est_minutes ?? 0,
    slaMinutes: x.slaMinutes ?? x.sla_minutes ?? 0,
    startedAt: x.startedAt ?? (x.started_at ? new Date(x.started_at).toISOString().slice(0, 16) : undefined),
    completedAt: x.completedAt ?? (x.completed_at ? new Date(x.completed_at).toISOString().slice(0, 16) : undefined),
    gates: x.gates ?? {},
    submission: x.submission ?? undefined,
    review: x.review ?? undefined,
    audit: x.audit ?? [],
  }));

  const upiWorkerIds = Array.from(new Set((upiRes.data ?? []).map((u: any) => String(u.worker_id ?? "")).filter(Boolean)));
  const upiProfilesRes = upiWorkerIds.length
    ? await sb.from("profiles").select("id,worker_code").in("id", upiWorkerIds)
    : { data: [] as any[] };
  const upiCodeById = new Map<string, string>((upiProfilesRes.data ?? []).map((p: any) => [String(p.id), String(p.worker_code ?? p.id)]));

  return json(200, {
    ok: true,
    workers,
    accounts,
    assignments,
    workItems,
    upiConfigs: (upiRes.error ? [] : upiRes.data ?? []).map((u: any) => ({
      workerId: String(u.worker_id ?? ""),
      workerCode: upiCodeById.get(String(u.worker_id ?? "")),
      upiId: String(u.upi_id ?? ""),
      verified: !!u.verified,
      verifiedAt: u.verified_at ?? undefined,
      payoutSchedule: u.payout_schedule ?? undefined,
      payoutDay: u.payout_day ?? undefined,
    })),
    errors: [
      ...(accountsRes.error ? [{ table: "accounts", message: accountsRes.error.message }] : []),
      ...assignmentErrors,
      ...(upiRes.error ? [{ table: "upi_configs", message: upiRes.error.message }] : []),
      ...(workItemsRes.error ? [{ table: "work_items", message: workItemsRes.error.message }] : []),
    ],
  });
}
