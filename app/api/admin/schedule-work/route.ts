import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

const DEFAULT_TIMES = ["08:00", "18:00"];
const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_DEADLINE_MIN = 180;

function parseHHMM(s: string, fallback: { hour: number; minute: number }) {
  const parts = s.split(":").map((p) => Number(p));
  if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return fallback;
  const hour = Math.max(0, Math.min(23, parts[0]));
  const minute = Math.max(0, Math.min(59, parts[1]));
  return { hour, minute };
}

function normalizeSchedule(input: any): { times: string[]; days: number[]; deadlineMin: number; timezone: string } {
  const deadlineMin = Math.max(60, Math.min(720, Number(input?.deadlineMin ?? DEFAULT_DEADLINE_MIN)));
  const times = Array.isArray(input?.times) && input.times.length ? input.times : [input?.morning, input?.evening];
  const normalized = times
    .map((t: any) => String(t || "").trim())
    .filter((t: string) => /^\d{2}:\d{2}$/.test(t));
  const unique = Array.from(new Set<string>(normalized.length ? normalized : DEFAULT_TIMES));
  const daysRaw: unknown[] = Array.isArray(input?.days) ? input.days : DEFAULT_DAYS;
  const validDays = daysRaw.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6);
  const days = Array.from(new Set<number>(validDays)).sort((a, b) => a - b);
  const timezone = String(input?.timezone || DEFAULT_TIMEZONE);
  return { times: unique, days: days.length ? days : DEFAULT_DAYS, deadlineMin, timezone };
}

function getTzParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type === "year") map.year = Number(p.value);
    if (p.type === "month") map.month = Number(p.value);
    if (p.type === "day") map.day = Number(p.value);
    if (p.type === "hour") map.hour = Number(p.value);
    if (p.type === "minute") map.minute = Number(p.value);
  }
  return map as { year: number; month: number; day: number; hour: number; minute: number };
}

function zonedTimeToUtcIso(y: number, m: number, day: number, hour: number, minute: number, timeZone: string) {
  let utc = Date.UTC(y, m - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 2; i += 1) {
    const parts = getTzParts(new Date(utc), timeZone);
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const desired = Date.UTC(y, m - 1, day, hour, minute, 0, 0);
    const diff = desired - actual;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc).toISOString();
}

function buildNextTwoSlots(schedule: { times: string[]; days: number[]; deadlineMin: number; timezone: string }) {
  const nowUtc = new Date();
  const nowLocal = getTzParts(nowUtc, schedule.timezone);
  const deadline = Math.max(60, Math.min(720, Number(schedule.deadlineMin) || DEFAULT_DEADLINE_MIN));

  const candidates: Array<{ label: string; dueAt: string }> = [];
  const base = new Date(Date.UTC(nowLocal.year, nowLocal.month - 1, nowLocal.day));
  for (let offset = 0; offset < 14; offset += 1) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + offset);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (!schedule.days.includes(dow)) continue;

    for (let i = 0; i < schedule.times.length; i += 1) {
      const slotTime = parseHHMM(schedule.times[i], { hour: 8, minute: 0 });
      const label = i === 0 ? "AM" : i === 1 ? "PM" : `S${i + 1}`;
      const totalMinutes = slotTime.hour * 60 + slotTime.minute + deadline;
      const dueHour = Math.floor(totalMinutes / 60) % 24;
      const dueMinute = totalMinutes % 60;
      const extraDays = Math.floor(totalMinutes / 1440);
      const dueDate = new Date(Date.UTC(y, m - 1, day + extraDays));
      const dueAt = zonedTimeToUtcIso(
        dueDate.getUTCFullYear(),
        dueDate.getUTCMonth() + 1,
        dueDate.getUTCDate(),
        dueHour,
        dueMinute,
        schedule.timezone
      );
      candidates.push({ label, dueAt });
    }
  }

  const nowIso = nowUtc.toISOString();
  return candidates.filter((c) => c.dueAt >= nowIso).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 2);
}

const isMissingColumn = (msg?: string | null) => {
  if (!msg) return false;
  return (
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("Could not find the") && msg.includes("column")) ||
    msg.includes("schema cache")
  );
};

async function persistAccountSchedule(
  sb: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  schedule: { times: string[]; days: number[]; deadlineMin: number; timezone: string }
) {
  const primaryTimes = schedule.times.length ? schedule.times : DEFAULT_TIMES;
  let update = await sb.from("accounts").update({ schedule }).eq("id", accountId);
  if (!update.error) return;
  if (isMissingColumn(update.error.message)) {
    update = await sb
      .from("accounts")
      .update({
        schedule_morning: primaryTimes[0] ?? DEFAULT_TIMES[0],
        schedule_evening: primaryTimes[1] ?? DEFAULT_TIMES[1],
        deadline_minutes: schedule.deadlineMin,
      })
      .eq("id", accountId);
  }
  if (update.error && isMissingColumn(update.error.message)) {
    await sb
      .from("accounts")
      .update({
        scheduleMorning: primaryTimes[0] ?? DEFAULT_TIMES[0],
        scheduleEvening: primaryTimes[1] ?? DEFAULT_TIMES[1],
        deadlineMinutes: schedule.deadlineMin,
      })
      .eq("id", accountId);
  }
}

async function persistAssignmentSchedule(
  sb: ReturnType<typeof supabaseAdmin>,
  workerId: string,
  accountId: string,
  schedule: { times: string[]; days: number[]; deadlineMin: number; timezone: string }
) {
  let update = await sb
    .from("assignments")
    .update({ schedule })
    .or(`workerId.eq.${workerId},worker_id.eq.${workerId}`)
    .or(`accountId.eq.${accountId},account_id.eq.${accountId}`);
  if (update.error && isMissingColumn(update.error.message)) {
    update = await sb
      .from("assignments")
      .update({
        schedule_morning: schedule.times[0] ?? DEFAULT_TIMES[0],
        schedule_evening: schedule.times[1] ?? DEFAULT_TIMES[1],
        deadline_minutes: schedule.deadlineMin,
        schedule_days: schedule.days,
        schedule_timezone: schedule.timezone,
      })
      .or(`worker_id.eq.${workerId},workerId.eq.${workerId}`)
      .or(`account_id.eq.${accountId},accountId.eq.${accountId}`);
  }
  if (update.error && isMissingColumn(update.error.message)) {
    await sb
      .from("assignments")
      .update({
        scheduleMorning: schedule.times[0] ?? DEFAULT_TIMES[0],
        scheduleEvening: schedule.times[1] ?? DEFAULT_TIMES[1],
        deadlineMinutes: schedule.deadlineMin,
        schedule_days: schedule.days,
        schedule_timezone: schedule.timezone,
      })
      .or(`worker_id.eq.${workerId},workerId.eq.${workerId}`)
      .or(`account_id.eq.${accountId},accountId.eq.${accountId}`);
  }

  let waUpdate = await sb
    .from("worker_account_assignments")
    .update({ schedule })
    .or(`worker_id.eq.${workerId},account_id.eq.${accountId}`);
  if (waUpdate.error && isMissingColumn(waUpdate.error.message)) {
    waUpdate = await sb
      .from("worker_account_assignments")
      .update({
        schedule_morning: schedule.times[0] ?? DEFAULT_TIMES[0],
        schedule_evening: schedule.times[1] ?? DEFAULT_TIMES[1],
        deadline_minutes: schedule.deadlineMin,
        schedule_days: schedule.days,
        schedule_timezone: schedule.timezone,
      })
      .or(`worker_id.eq.${workerId},account_id.eq.${accountId}`);
  }
  if (waUpdate.error && isMissingColumn(waUpdate.error.message)) {
    await sb
      .from("worker_account_assignments")
      .update({
        scheduleMorning: schedule.times[0] ?? DEFAULT_TIMES[0],
        scheduleEvening: schedule.times[1] ?? DEFAULT_TIMES[1],
        deadlineMinutes: schedule.deadlineMin,
        schedule_days: schedule.days,
        schedule_timezone: schedule.timezone,
      })
      .or(`worker_id.eq.${workerId},account_id.eq.${accountId}`);
  }
}

async function persistAssignmentsScheduleAll(
  sb: ReturnType<typeof supabaseAdmin>,
  schedule: { times: string[]; days: number[]; deadlineMin: number; timezone: string }
) {
  let update = await sb.from("assignments").update({ schedule });
  if (update.error && isMissingColumn(update.error.message)) {
    update = await sb.from("assignments").update({
      schedule_morning: schedule.times[0] ?? DEFAULT_TIMES[0],
      schedule_evening: schedule.times[1] ?? DEFAULT_TIMES[1],
      deadline_minutes: schedule.deadlineMin,
      schedule_days: schedule.days,
      schedule_timezone: schedule.timezone,
    });
  }
  if (update.error && isMissingColumn(update.error.message)) {
    await sb.from("assignments").update({
      scheduleMorning: schedule.times[0] ?? DEFAULT_TIMES[0],
      scheduleEvening: schedule.times[1] ?? DEFAULT_TIMES[1],
      deadlineMinutes: schedule.deadlineMin,
      schedule_days: schedule.days,
      schedule_timezone: schedule.timezone,
    });
  }

  let waUpdate = await sb.from("worker_account_assignments").update({ schedule });
  if (waUpdate.error && isMissingColumn(waUpdate.error.message)) {
    waUpdate = await sb.from("worker_account_assignments").update({
      schedule_morning: schedule.times[0] ?? DEFAULT_TIMES[0],
      schedule_evening: schedule.times[1] ?? DEFAULT_TIMES[1],
      deadline_minutes: schedule.deadlineMin,
      schedule_days: schedule.days,
      schedule_timezone: schedule.timezone,
    });
  }
  if (waUpdate.error && isMissingColumn(waUpdate.error.message)) {
    await sb.from("worker_account_assignments").update({
      scheduleMorning: schedule.times[0] ?? DEFAULT_TIMES[0],
      scheduleEvening: schedule.times[1] ?? DEFAULT_TIMES[1],
      deadlineMinutes: schedule.deadlineMin,
      schedule_days: schedule.days,
      schedule_timezone: schedule.timezone,
    });
  }
}

async function insertScheduledItems(sb: ReturnType<typeof supabaseAdmin>, rows: any[]) {
  let ins = await sb.from("work_items").insert(rows);
  if (!ins.error) return null;
  if (isMissingColumn(ins.error.message)) {
    const minimalSnake = rows.map((r) => ({
      title: r.title,
      type: r.type,
      account_id: r.account_id,
      worker_id: r.worker_id,
      due_at: r.due_at,
      status: r.status,
    }));
    ins = await sb.from("work_items").insert(minimalSnake);
  }
  if (!ins.error) return null;
  if (isMissingColumn(ins.error.message)) {
    const camel = rows.map((r) => ({
      title: r.title,
      type: r.type,
      accountId: r.account_id,
      workerId: r.worker_id,
      createdAt: r.created_at,
      dueAt: r.due_at,
      status: r.status,
      priority: r.priority,
      rewardINR: r.reward_inr,
      estMinutes: r.est_minutes,
      slaMinutes: r.sla_minutes,
      gates: r.gates,
    }));
    ins = await sb.from("work_items").insert(camel);
  }
  if (!ins.error) return null;
  if (isMissingColumn(ins.error.message)) {
    const minimalCamel = rows.map((r) => ({
      title: r.title,
      type: r.type,
      accountId: r.account_id,
      workerId: r.worker_id,
      dueAt: r.due_at,
      status: r.status,
    }));
    ins = await sb.from("work_items").insert(minimalCamel);
  }
  return ins.error ? ins.error.message : null;
}

async function fetchExistingWorkItems(sb: ReturnType<typeof supabaseAdmin>, accountId: string) {
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

  if (!rows.length) return { rows: [] as any[], useCamel: false };

  const unique = new Map<string, any>();
  for (const r of rows) {
    const key = String(r.id ?? r.public_id ?? Math.random());
    if (!unique.has(key)) unique.set(key, r);
  }
  return { rows: Array.from(unique.values()), useCamel };
}

async function pruneExtraOpenItems(sb: ReturnType<typeof supabaseAdmin>, rows: any[], useCamel: boolean) {
  const openRows = rows.filter((x) => String(x.status ?? "").toLowerCase() === "open");
  if (!openRows.length) return;

  const nowIso = new Date().toISOString();
  const normalized = openRows
    .map((x) => {
      const raw = useCamel ? x.dueAt : x.due_at;
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return null;
      return { row: x, dueIso: date.toISOString() };
    })
    .filter(Boolean) as Array<{ row: any; dueIso: string }>;

  if (!normalized.length) return;

  const future = normalized.filter((x) => x.dueIso >= nowIso).sort((a, b) => a.dueIso.localeCompare(b.dueIso));
  const past = normalized.filter((x) => x.dueIso < nowIso).sort((a, b) => a.dueIso.localeCompare(b.dueIso));

  const keep = future.slice(0, 2);
  if (keep.length < 2) {
    const pastKeep = past.slice(-1 * (2 - keep.length));
    keep.push(...pastKeep);
  }

  const keepIds = new Set(keep.map((x) => x.row.id ?? x.row.public_id).filter(Boolean));
  const extra = openRows.filter((x) => {
    const id = x.id ?? x.public_id;
    return id && !keepIds.has(id);
  });
  if (!extra.length) return;
  const ids = extra.map((x) => x.id).filter(Boolean);
  if (ids.length) {
    let del = await sb.from("work_items").delete().in("id", ids);
    if (del.error && isMissingColumn(del.error.message)) {
      const pubIds = extra.map((x) => x.public_id).filter(Boolean);
      if (pubIds.length) {
        del = await sb.from("work_items").delete().in("public_id", pubIds);
      }
    }
  }
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

  if (!rows.length) return;
  await pruneExtraOpenItems(sb, rows, useCamel);
}

async function deleteOpenItemsForAccount(sb: ReturnType<typeof supabaseAdmin>, accountId: string) {
  let del = await sb.from("work_items").delete().eq("account_id", accountId).eq("status", "Open");
  if (!del.error) return;
  if (isMissingColumn(del.error.message)) {
    del = await sb.from("work_items").delete().eq("accountId", accountId).eq("status", "Open");
  }
}
async function scheduleForAssignment(
  sb: ReturnType<typeof supabaseAdmin>,
  adminId: string,
  workerId: string,
  accountId: string,
  _workerIds: string[],
  schedule: { times: string[]; days: number[]; deadlineMin: number; timezone: string },
  reschedule: boolean
) {
  await persistAssignmentSchedule(sb, workerId, accountId, schedule);
  if (reschedule) {
    await deleteOpenItemsForAccount(sb, accountId);
  }
  let slaUpdate = await sb.from("work_items").update({ sla_minutes: schedule.deadlineMin }).eq("account_id", accountId).eq("status", "Open");
  if (slaUpdate.error && isMissingColumn(slaUpdate.error.message)) {
    slaUpdate = await sb.from("work_items").update({ slaMinutes: schedule.deadlineMin }).eq("accountId", accountId).eq("status", "Open");
  }
  await persistAccountSchedule(sb, accountId, schedule);
  const accountRes = await sb.from("accounts").select("id,handle,policyTier,policy_tier").eq("id", accountId).maybeSingle();
  const handleRaw = String(accountRes.data?.handle ?? accountId);
  const handle = handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`;
  const policyTier = (accountRes.data as any)?.policyTier ?? (accountRes.data as any)?.policy_tier;
  const strict = String(policyTier ?? "").toLowerCase() === "strict";

  const nextSlots = buildNextTwoSlots(schedule);
  if (nextSlots.length === 0) return null;

  const existingRes = await fetchExistingWorkItems(sb, accountId);
  const existingRows = existingRes.rows;
  const existingDue = new Set(
    existingRows
      .filter((x) => {
        const status = String(x.status ?? "").toLowerCase();
        return status === "open" || status === "in progress" || status === "needs fix";
      })
      .map((x) => {
        const raw = existingRes.useCamel ? x.dueAt : x.due_at;
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      })
      .filter(Boolean)
  );
  await pruneExtraOpenItems(sb, existingRows, existingRes.useCamel);

  const rows = nextSlots
    .filter((d) => !existingDue.has(d.dueAt))
    .map((d) => ({
      public_id: `SCH-${Math.floor(1000 + Math.random() * 9000)}`,
      title: `Post reel for ${handle} (${d.label})`,
      type: "Reel posting",
      account_id: accountId,
      worker_id: workerId,
      created_by: adminId,
      due_at: d.dueAt,
      status: "Open",
      priority: "P1",
      reward_inr: 5,
      est_minutes: 30,
      sla_minutes: schedule.deadlineMin,
      gates: {
        captionTemplate: true,
        approvedAudio: strict ? false : true,
        hashtagsOk: true,
        noRestricted: true,
        proofAttached: false,
      },
    }));

  if (rows.length) {
    return await insertScheduledItems(sb, rows);
  }
  return null;
}

async function resolveWorkerIds(sb: ReturnType<typeof supabaseAdmin>, workerId: string) {
  const byCode = await sb.from("profiles").select("id,worker_code").eq("worker_code", workerId).maybeSingle();
  if (byCode.data?.id) {
    return Array.from(new Set([String(byCode.data.id), String(byCode.data.worker_code ?? workerId), workerId].filter(Boolean)));
  }
  const byId = await sb.from("profiles").select("id,worker_code").eq("id", workerId).maybeSingle();
  if (byId.data?.id) {
    return Array.from(new Set([String(byId.data.id), String(byId.data.worker_code ?? workerId), workerId].filter(Boolean)));
  }
  return [workerId];
}

export async function POST(req: Request) {
  const devBypass = req.headers.get("x-dev-bypass");
  const allowBypass = devBypass === "1" && process.env.NODE_ENV !== "production";
  const guard = allowBypass ? { ok: true as const, userId: "dev-bypass" } : await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const body = await req.json().catch(() => ({}));
  const workerId = String(body?.workerId ?? "").trim();
  const accountId = String(body?.accountId ?? "").trim();
  const schedule = normalizeSchedule(body?.schedule ?? {});
  const reschedule = Boolean(body?.reschedule);
  const applyToAssignments = Boolean(body?.applyToAssignments);

  const sb = supabaseAdmin();

  if (workerId && accountId) {
    const workerIds = await resolveWorkerIds(sb, workerId);
    const err = await scheduleForAssignment(sb, guard.userId, workerIds[0], accountId, workerIds, schedule, reschedule);
    return json(200, { ok: !err, error: err ?? undefined });
  }

  let assignmentsRes = await sb.from("assignments").select("workerId,accountId,worker_id,account_id");
  if (assignmentsRes.error) {
    assignmentsRes = await sb.from("worker_account_assignments").select("worker_id,account_id");
  }
  if (assignmentsRes.error) {
    assignmentsRes = await sb.from("worker_accounts").select("worker_id,account_id");
  }
  if (assignmentsRes.error) return json(500, { ok: false, error: assignmentsRes.error.message });

  const errors: Array<{ workerId: string; accountId: string; error: string }> = [];
  for (const asg of assignmentsRes.data ?? []) {
    const wid = String((asg as any).workerId ?? (asg as any).worker_id ?? "");
    const aid = String((asg as any).accountId ?? (asg as any).account_id ?? "");
    if (!wid || !aid) continue;
    const workerIds = await resolveWorkerIds(sb, wid);
    const err = await scheduleForAssignment(sb, guard.userId, workerIds[0], aid, workerIds, schedule, reschedule);
    await cleanupAccountWorkItems(sb, aid);
    if (err) errors.push({ workerId: wid, accountId: aid, error: err });
  }

  if (applyToAssignments) {
    await persistAssignmentsScheduleAll(sb, schedule);
  }

  return json(200, { ok: errors.length === 0, errors });
}
