import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  dashboardDevHeaders,
  getDevDashboardWorkers,
  isDashboardDevMode,
  updateDevDashboardWorkerIdentity,
} from "@/lib/dashboardDevData";

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
type WorkerRow = {
  id?: unknown;
  name?: unknown;
  email?: unknown;
  active?: unknown;
  user_id?: unknown;
};
type WorkerProfileRow = {
  id?: unknown;
  display_name?: unknown;
  worker_code?: unknown;
};
type WorkerCodeRow = {
  id?: unknown;
  worker_code?: unknown;
};
type AssignmentRow = {
  workerId?: unknown;
  accountId?: unknown;
  worker_id?: unknown;
  account_id?: unknown;
  schedule?: unknown;
};
type AccountRow = {
  id?: unknown;
  handle?: unknown;
  niche?: unknown;
  ownerTeam?: unknown;
  owner_team?: unknown;
  policyTier?: unknown;
  policy_tier?: unknown;
  health?: unknown;
  rules?: unknown;
  allowedAudios?: unknown;
  allowed_audios?: unknown;
  requiredHashtags?: unknown;
  required_hashtags?: unknown;
};

function normId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isSchemaMismatch(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("relation") ||
    lower.includes("undefined table") ||
    lower.includes("schema cache") ||
    lower.includes("could not find") ||
    lower.includes("column")
  );
}

function cleanIdentity(body: Record<string, unknown>) {
  const name = String(body.name ?? body.displayName ?? "").trim().slice(0, 120);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 180);
  const workerId = String(body.workerId ?? body.id ?? "").trim().slice(0, 80);
  const userId = String(body.userId ?? "").trim().slice(0, 120);
  return { name, email, workerId, userId };
}

/** Brand-facing profile details (migration 202610110003). Only keys present in the body are updated. */
const PROFILE_FIELD_LIMITS = { headline: 120, city: 80, bio: 600 } as const;
type ProfileFields = Partial<Record<keyof typeof PROFILE_FIELD_LIMITS, string>>;
function cleanProfileFields(body: Record<string, unknown>): ProfileFields {
  const fields: ProfileFields = {};
  for (const key of Object.keys(PROFILE_FIELD_LIMITS) as Array<keyof typeof PROFILE_FIELD_LIMITS>) {
    if (!(key in body) || body[key] === undefined || body[key] === null) continue;
    const raw = String(body[key]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    // Single-line fields collapse whitespace; the bio keeps up to two consecutive line breaks.
    const value = key === "bio" ? raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : raw.replace(/\s+/g, " ").trim();
    fields[key] = value.slice(0, PROFILE_FIELD_LIMITS[key]);
  }
  return fields;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function scheduleFrom(value: unknown) {
  return value && typeof value === "object" ? (value as AssignmentSchedule) : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

async function handleGET(request: Request) {
  const actor = await authenticate(request);
  if (isDashboardDevMode()) {
    const workerId = new URL(request.url).searchParams.get("workerId");
    return NextResponse.json(getDevDashboardWorkers(workerId), { headers: dashboardDevHeaders() });
  }

  const sb = supabaseAdmin();
  let workerQuery = sb.from("workers").select("id,name,email,active,user_id").order("id");
  if (!actor.isAdmin) workerQuery = workerQuery.eq("user_id", actor.user.id);
  const workersRes = await workerQuery;
  if (workersRes.error && !workersRes.error.message.includes("column")) {
    return NextResponse.json({ error: workersRes.error.message }, { status: 500 });
  }

  const workerRows = rows<WorkerRow>(workersRes.data);
  let workers = workerRows;
  if (workersRes.error || workers.length === 0) {
    let profileQuery = sb
      .from("profiles")
      .select("id,role,display_name,worker_code,created_at")
      .eq("role", "Worker")
      .order("created_at", { ascending: false });
    if (!actor.isAdmin) profileQuery = profileQuery.eq("id", actor.user.id);
    const profilesRes = await profileQuery;
    if (!profilesRes.error && Array.isArray(profilesRes.data)) {
      workers = rows<WorkerProfileRow>(profilesRes.data).map((profile) => ({
        id: String(profile.worker_code ?? profile.id),
        name: String(profile.display_name ?? "Worker"),
        email: "",
        active: true,
        user_id: String(profile.id),
      }));
    }
  }

  const workerIdByUserId = new Map<string, string>();
  for (const worker of workerRows) {
    const userId = worker.user_id;
    if (userId) workerIdByUserId.set(String(userId), String(worker.id));
  }

  const workerUserIds = Array.from(new Set(workerRows.map((worker) => String(worker.user_id ?? "")).filter(Boolean)));
  let workerCodeRows: WorkerCodeRow[] = [];
  if (workerUserIds.length) {
    const profilesForWorkers = await sb.from("profiles").select("id,worker_code").in("id", workerUserIds);
    workerCodeRows = rows<WorkerCodeRow>(profilesForWorkers.data);
  }
  const workerCodeByUserId = new Map<string, string>(
    workerCodeRows.map((profile) => [String(profile.id), String(profile.worker_code ?? profile.id)])
  );
  // Headline / location / bio; missing columns (migration not applied yet) simply mean "not set".
  const detailUserIds = Array.from(new Set(workers.map((worker) => String(worker.user_id ?? "")).filter(Boolean)));
  const detailsByUserId = new Map<string, { headline: string; city: string; bio: string }>();
  if (detailUserIds.length) {
    const details = await sb.from("profiles").select("id,headline,city,bio").in("id", detailUserIds);
    if (!details.error) {
      for (const row of rows<{ id?: unknown; headline?: unknown; city?: unknown; bio?: unknown }>(details.data)) {
        detailsByUserId.set(String(row.id), { headline: String(row.headline ?? ""), city: String(row.city ?? ""), bio: String(row.bio ?? "") });
      }
    }
  }

  const assignmentsRows: Array<{ workerId: string; accountId: string; schedule?: AssignmentSchedule }> = [];
  let firstAssignments = sb.from("assignments").select("worker_id,account_id,schedule");
  if (!actor.isAdmin) firstAssignments = firstAssignments.eq("worker_id", actor.user.id);
  const asg1 = await firstAssignments;
  if (!asg1.error) {
    for (const assignment of rows<AssignmentRow>(asg1.data)) {
      assignmentsRows.push({
        workerId: String(assignment.workerId ?? assignment.worker_id ?? ""),
        accountId: String(assignment.accountId ?? assignment.account_id ?? ""),
        schedule: scheduleFrom(assignment.schedule),
      });
    }
  }
  let secondAssignments = sb.from("worker_account_assignments").select("worker_id,account_id,schedule");
  if (!actor.isAdmin) secondAssignments = secondAssignments.eq("worker_id", actor.user.id);
  const asg2 = await secondAssignments;
  if (!asg2.error) {
    for (const assignment of rows<AssignmentRow>(asg2.data)) {
      assignmentsRows.push({
        workerId: String(assignment.worker_id ?? ""),
        accountId: String(assignment.account_id ?? ""),
        schedule: scheduleFrom(assignment.schedule),
      });
    }
  }
  let thirdAssignments = sb.from("worker_accounts").select("worker_id,account_id");
  if (!actor.isAdmin) thirdAssignments = thirdAssignments.eq("worker_id", actor.user.id);
  const asg3 = await thirdAssignments;
  if (!asg3.error) {
    for (const assignment of rows<AssignmentRow>(asg3.data)) {
      assignmentsRows.push({ workerId: String(assignment.worker_id ?? ""), accountId: String(assignment.account_id ?? "") });
    }
  }

  const uniqueAssignments = new Map<string, { workerId: string; accountId: string; schedule?: AssignmentSchedule }>();
  for (const as of assignmentsRows) {
    if (!as.workerId || !as.accountId) continue;
    uniqueAssignments.set(`${as.workerId}::${as.accountId}`, as);
  }

  const assignmentRows = Array.from(uniqueAssignments.values());
  const assignmentWorkerIds = Array.from(new Set(assignmentRows.map((a) => a.workerId)));
  let assignmentWorkerCodeRows: WorkerCodeRow[] = [];
  if (assignmentWorkerIds.length) {
    const profilesRes = await sb.from("profiles").select("id,worker_code").in("id", assignmentWorkerIds);
    assignmentWorkerCodeRows = rows<WorkerCodeRow>(profilesRes.data);
  }
  const codeById = new Map<string, string>(
    assignmentWorkerCodeRows.map((profile) => [String(profile.id), String(profile.worker_code ?? profile.id)])
  );

  const assignments = assignmentRows.map((as) => ({
    workerId: workerIdByUserId.get(as.workerId) ?? codeById.get(as.workerId) ?? as.workerId,
    accountId: as.accountId,
    schedule: as.schedule ?? undefined,
  }));

  const accountIds = Array.from(new Set(assignments.map((a) => a.accountId).filter(Boolean)));
  let accountRows: AccountRow[] = [];
  if (accountIds.length) {
    const accountsRes = await sb.from("accounts").select("*").in("id", accountIds);
    if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 500 });
    accountRows = rows<AccountRow>(accountsRes.data);
  }

  const accountsById = new Map<string, AssignedAccount>();
  for (const account of accountRows) {
    accountsById.set(String(account.id), {
      id: String(account.id),
      handle: String(account.handle ?? ""),
      niche: String(account.niche ?? ""),
      ownerTeam: String(account.ownerTeam ?? account.owner_team ?? ""),
      policyTier: String(account.policyTier ?? account.policy_tier ?? "Standard"),
      health: String(account.health ?? "Healthy"),
      rules: stringArray(account.rules),
      allowedAudios: stringArray(account.allowedAudios ?? account.allowed_audios),
      requiredHashtags: stringArray(account.requiredHashtags ?? account.required_hashtags),
    });
  }

  return NextResponse.json(
    workers.map((worker) => {
      const userId = String(worker.user_id ?? "");
      const workerId = workerCodeByUserId.get(userId) ?? String(worker.id);
      const aliases = new Set(
        [workerId, userId, String(worker.id), workerIdByUserId.get(userId), workerCodeByUserId.get(userId)]
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
        name: String(worker.name ?? ""),
        email: String(worker.email ?? ""),
        ...(detailsByUserId.get(userId) ?? {}),
        active: worker.active === undefined ? true : !!worker.active,
        assignedAccountIds,
        assignedAccounts,
        assignedAccountSchedules,
      };
    })
  );
}

async function handlePATCH(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const identity = cleanIdentity(body);
    const details = cleanProfileFields(body);

    if (!identity.name) {
      return NextResponse.json({ error: "name required" }, { status: 400, headers: dashboardDevHeaders() });
    }
    // Email is optional (profile-detail saves don't resend it), but when sent it must be a real address.
    if (identity.email && (!EMAIL_ADDRESS_PATTERN.test(identity.email) || identity.email.endsWith("@example.test"))) {
      return NextResponse.json({ error: "valid email required" }, { status: 400, headers: dashboardDevHeaders() });
    }

    if (isDashboardDevMode()) {
      const updated = updateDevDashboardWorkerIdentity(identity);
      return updated.ok
        ? NextResponse.json(updated.worker, { headers: dashboardDevHeaders() })
        : NextResponse.json({ error: updated.error }, { status: 400, headers: dashboardDevHeaders() });
    }

    const sb = supabaseAdmin();
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing Authorization" }, { status: 401, headers: dashboardDevHeaders() });
    }

    const token = authHeader.slice("Bearer ".length);
    const { data: authData, error: authError } = await sb.auth.getUser(token);
    if (authError || !authData.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401, headers: dashboardDevHeaders() });
    }

    const authUserId = authData.user.id;
    if (identity.userId && identity.userId !== authUserId) {
      return NextResponse.json({ error: "Cannot update another user profile" }, { status: 403, headers: dashboardDevHeaders() });
    }

    const existingMetadata =
      authData.user.user_metadata && typeof authData.user.user_metadata === "object" ? authData.user.user_metadata : {};
    const authUpdate = await sb.auth.admin.updateUserById(authUserId, {
      user_metadata: {
        ...existingMetadata,
        name: identity.name,
        full_name: identity.name,
        ...(identity.email ? { dashboard_email: identity.email, contact_email: identity.email } : {}),
      },
    });
    if (authUpdate.error) {
      return NextResponse.json({ error: authUpdate.error.message }, { status: 500, headers: dashboardDevHeaders() });
    }

    const profileRes = await sb.from("profiles").select("id,worker_code").eq("id", authUserId).maybeSingle();
    const profileWorkerCode = String((profileRes.data as WorkerCodeRow | null)?.worker_code ?? "").trim();
    if (profileRes.error && !isSchemaMismatch(profileRes.error.message)) {
      return NextResponse.json({ error: profileRes.error.message }, { status: 500, headers: dashboardDevHeaders() });
    }

    const profileUpdate = await sb.from("profiles").update({ display_name: identity.name, ...details }).eq("id", authUserId);
    if (profileUpdate.error) {
      if (Object.keys(details).length && isSchemaMismatch(profileUpdate.error.message)) {
        return NextResponse.json({ error: "Profile details aren't switched on yet. Try again shortly." }, { status: 503, headers: dashboardDevHeaders() });
      }
      if (!isSchemaMismatch(profileUpdate.error.message)) {
        return NextResponse.json({ error: profileUpdate.error.message }, { status: 500, headers: dashboardDevHeaders() });
      }
    }

    const workerPatch = { name: identity.name, ...(identity.email ? { email: identity.email } : {}) };
    let updatedWorker: WorkerRow | null = null;
    const byUser = await sb
      .from("workers")
      .update(workerPatch)
      .eq("user_id", authUserId)
      .select("id,name,email,active,user_id")
      .maybeSingle();
    if (byUser.error && !isSchemaMismatch(byUser.error.message)) {
      return NextResponse.json({ error: byUser.error.message }, { status: 500, headers: dashboardDevHeaders() });
    }
    updatedWorker = (byUser.data as WorkerRow | null) ?? null;

    const canUpdateByWorkerCode =
      !updatedWorker &&
      identity.workerId &&
      profileWorkerCode &&
      normId(identity.workerId) === normId(profileWorkerCode);
    if (canUpdateByWorkerCode) {
      const byWorkerCode = await sb
        .from("workers")
        .update(workerPatch)
        .eq("id", identity.workerId)
        .select("id,name,email,active,user_id")
        .maybeSingle();
      if (byWorkerCode.error && !isSchemaMismatch(byWorkerCode.error.message)) {
        return NextResponse.json({ error: byWorkerCode.error.message }, { status: 500, headers: dashboardDevHeaders() });
      }
      updatedWorker = (byWorkerCode.data as WorkerRow | null) ?? updatedWorker;
    }

    const resolvedWorkerId = profileWorkerCode || String(updatedWorker?.id ?? identity.workerId ?? authUserId);
    return NextResponse.json(
      {
        id: resolvedWorkerId,
        workerId: resolvedWorkerId,
        userId: authUserId,
        name: identity.name,
        email: identity.email || String(updatedWorker?.email ?? ""),
        ...details,
        active: updatedWorker?.active === undefined ? true : !!updatedWorker.active,
      },
      { headers: dashboardDevHeaders() }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid payload" },
      { status: 400, headers: dashboardDevHeaders() }
    );
  }
}

export const GET = withApi({ auth: "user" }, handleGET);

export const PATCH = withApi({ auth: "user" }, handlePATCH);
