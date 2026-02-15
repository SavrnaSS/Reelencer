import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const IST_OFFSET_MIN = 330;
const DEFAULT_TIMES = ["08:00", "18:00"];
const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_DEADLINE_MIN = 180;

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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
  const normalized = {
    times: schedule?.times?.length ? schedule.times : DEFAULT_TIMES,
    days: schedule?.days?.length ? schedule.days : DEFAULT_DAYS,
    deadlineMin: schedule?.deadlineMin ?? DEFAULT_DEADLINE_MIN,
    timezone: schedule?.timezone ?? DEFAULT_TIMEZONE,
  };
  const nowUtc = new Date();
  const nowLocal = getTzParts(nowUtc, normalized.timezone);
  const deadline = Math.max(60, Math.min(720, Number(normalized.deadlineMin) || DEFAULT_DEADLINE_MIN));

  const candidates: Array<{ label: string; dueAt: string }> = [];
  const base = new Date(Date.UTC(nowLocal.year, nowLocal.month - 1, nowLocal.day));
  for (let offset = 0; offset < 14; offset += 1) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + offset);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (!normalized.days.includes(dow)) continue;

    for (let i = 0; i < normalized.times.length; i += 1) {
      const slotTime = parseHHMM(normalized.times[i], { hour: 8, minute: 0 });
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
        normalized.timezone
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

async function fetchAccountSchedule(sb: ReturnType<typeof supabaseAdmin>, accountId: string) {
  const fallback = { times: DEFAULT_TIMES, deadlineMin: DEFAULT_DEADLINE_MIN };
  const fallbackFull = { times: DEFAULT_TIMES, days: DEFAULT_DAYS, deadlineMin: DEFAULT_DEADLINE_MIN, timezone: DEFAULT_TIMEZONE };

  let account: any = null;
      let res: any = await sb
    .from("accounts")
    .select("id,handle,policyTier,policy_tier,schedule,schedule_days,schedule_timezone,timezone")
    .eq("id", accountId)
    .maybeSingle();
  if (res.error && isMissingColumn(res.error.message)) {
    res = await sb
      .from("accounts")
      .select("id,handle,policyTier,policy_tier,schedule_morning,schedule_evening,deadline_minutes,schedule_days,schedule_timezone,timezone")
      .eq("id", accountId)
      .maybeSingle();
  }
  if (res.error && isMissingColumn(res.error.message)) {
    res = await sb
      .from("accounts")
      .select("id,handle,policyTier,policy_tier,scheduleMorning,scheduleEvening,deadlineMinutes,schedule_days,schedule_timezone,timezone")
      .eq("id", accountId)
      .maybeSingle();
  }
  if (res.error && isMissingColumn(res.error.message)) {
    res = await sb.from("accounts").select("id,handle").eq("id", accountId).maybeSingle();
  }
  if (!res.error) account = res.data;

  const schedule = normalizeSchedule(account?.schedule ?? {});
  const times =
    schedule.times.length > 0
      ? schedule.times
      : normalizeSchedule({
          times: [account?.schedule_morning ?? account?.scheduleMorning, account?.schedule_evening ?? account?.scheduleEvening],
        }).times;
  const days =
    schedule.days.length > 0
      ? schedule.days
      : normalizeSchedule({ days: account?.schedule_days ?? DEFAULT_DAYS }).days;
  const timezone = String(account?.schedule_timezone ?? account?.timezone ?? schedule.timezone ?? DEFAULT_TIMEZONE);
  const deadlineRaw =
    schedule.deadlineMin ??
    account?.deadline_minutes ??
    account?.deadlineMin ??
    account?.deadlineMinutes ??
    DEFAULT_DEADLINE_MIN;
  const deadlineMin = Math.max(60, Math.min(720, Number(deadlineRaw) || DEFAULT_DEADLINE_MIN));

  const handleRaw = String(account?.handle ?? accountId);
  const handle = handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`;
  const policyTier = account?.policyTier ?? account?.policy_tier;
  const strict = String(policyTier ?? "").toLowerCase() === "strict";

  return { schedule: { times, days, deadlineMin, timezone }, handle, strict };
}

async function fetchAssignmentSchedule(
  sb: ReturnType<typeof supabaseAdmin>,
  workerIds: string[],
  accountId: string
) {
  const fallbackFull = { times: DEFAULT_TIMES, days: DEFAULT_DAYS, deadlineMin: DEFAULT_DEADLINE_MIN, timezone: DEFAULT_TIMEZONE };
  const workers = workerIds.filter(Boolean);

  let res: any = await sb
    .from("assignments")
    .select(
      "schedule,schedule_morning,schedule_evening,deadline_minutes,scheduleMorning,scheduleEvening,deadlineMin,deadlineMinutes,schedule_days,schedule_timezone,timezone,workerId,worker_id,accountId,account_id"
    )
    .or(`accountId.eq.${accountId},account_id.eq.${accountId}`);
  if (res.error && isMissingColumn(res.error.message)) {
    res = await sb
      .from("assignments")
      .select("schedule,schedule_morning,schedule_evening,deadline_minutes,schedule_days,schedule_timezone,timezone,worker_id,account_id")
      .eq("account_id", accountId);
  }
  if (res.error && isMissingColumn(res.error.message)) {
    res = await sb
      .from("worker_account_assignments")
      .select("schedule,schedule_morning,schedule_evening,deadline_minutes,schedule_days,schedule_timezone,timezone,worker_id,account_id")
      .eq("account_id", accountId);
  }
  if (res.error) return { schedule: fallbackFull };
  const row = Array.isArray(res.data)
    ? (res.data as any[]).find((r) => {
        const wid = String(r.workerId ?? r.worker_id ?? "");
        return workers.includes(wid);
      })
    : null;
  if (!row) return { schedule: fallbackFull };

  const schedule = normalizeSchedule(row.schedule ?? {});
  const times =
    schedule.times.length > 0
      ? schedule.times
      : normalizeSchedule({
          times: [row.schedule_morning ?? row.scheduleMorning, row.schedule_evening ?? row.scheduleEvening],
        }).times;
  const days =
    schedule.days.length > 0
      ? schedule.days
      : normalizeSchedule({ days: row.schedule_days ?? DEFAULT_DAYS }).days;
  const timezone = String(row.schedule_timezone ?? row.timezone ?? schedule.timezone ?? DEFAULT_TIMEZONE);
  const deadlineRaw =
    schedule.deadlineMin ?? row.deadline_minutes ?? row.deadlineMin ?? row.deadlineMinutes ?? DEFAULT_DEADLINE_MIN;
  const deadlineMin = Math.max(60, Math.min(720, Number(deadlineRaw) || DEFAULT_DEADLINE_MIN));
  return { schedule: { times, days, deadlineMin, timezone } };
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

async function ensureScheduledWork(
  sb: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  workerIds: string[]
) {
  const accountSchedule = await fetchAccountSchedule(sb, accountId);
  const assignmentSchedule = await fetchAssignmentSchedule(sb, workerIds, accountId);
  const schedule = assignmentSchedule.schedule?.times?.length ? assignmentSchedule.schedule : accountSchedule.schedule;
  const { handle, strict } = accountSchedule;
  const nextSlots = buildNextTwoSlots(schedule);
  if (!nextSlots.length) return;
  const workerId = workerIds[0];

  const existingRes = await fetchExistingWorkItems(sb, accountId);
  const existingRows = existingRes.rows;
  const existingDue = new Set(
    existingRows
      .filter((x) => {
        const status = String(x.status ?? "").toLowerCase();
        // Keep scheduled loop stable: do not create duplicate slot items while
        // a slot is still being processed or waiting admin review.
        return status === "open" || status === "in progress" || status === "needs fix" || status === "submitted";
      })
      .map((x) => {
        const raw = existingRes.useCamel ? x.dueAt : x.due_at;
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      })
      .filter(Boolean)
  );

  const rows = nextSlots
    .filter((d) => !existingDue.has(d.dueAt))
      .map((d) => ({
        public_id: `SCH-${Math.floor(1000 + Math.random() * 9000)}`,
        title: `Post reel for ${handle} (${d.label})`,
        type: "Reel posting",
        account_id: accountId,
        worker_id: workerId,
      created_by: "system",
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
    await insertScheduledItems(sb, rows);
  }
  const refreshed = await fetchExistingWorkItems(sb, accountId);
  await pruneExtraOpenItems(sb, refreshed.rows, refreshed.useCamel);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workerId = url.searchParams.get("workerId");
  const scope = url.searchParams.get("scope");
  if (!workerId) return NextResponse.json({ error: "workerId is required" }, { status: 400 });

  const sb = supabaseAdmin();

  let workerUuid = workerId;
  const byCode = await sb.from("profiles").select("id,worker_code").eq("worker_code", workerId).maybeSingle();
  if (byCode.data?.id) {
    workerUuid = String(byCode.data.id);
  } else {
    const byWorker = await sb.from("workers").select("user_id").eq("id", workerId).maybeSingle();
    if (byWorker.data?.user_id) workerUuid = String(byWorker.data.user_id);
  }
  const workerUuidResolved = isUuid(workerUuid) ? workerUuid : null;
  if (!workerUuidResolved) {
    return NextResponse.json([]);
  }

  // get assigned accounts (fallback if table exists but is empty)
  const workerUuidCandidates = [workerUuidResolved];
  const assignmentSources = [
    ...(workerUuidCandidates.length
      ? [
          () => sb.from("worker_accounts").select("account_id").in("worker_id", workerUuidCandidates),
          () => sb.from("worker_account_assignments").select("account_id").in("worker_id", workerUuidCandidates),
        ]
      : []),
    async () => {
      let res: any = await sb
        .from("assignments")
        .select("accountId,account_id,workerId,worker_id")
        .or(workerUuidResolved ? `workerId.eq.${workerId},worker_id.eq.${workerUuidResolved}` : `workerId.eq.${workerId}`);
      if (res.error && isMissingColumn(res.error.message)) {
        if (!workerUuidResolved) return { data: [], error: null };
        res = await sb.from("assignments").select("account_id,worker_id").eq("worker_id", workerUuidResolved);
      }
      return res;
    },
  ];
  let accountIds: string[] = [];
  let lastError: any = null;

  for (const load of assignmentSources) {
    const res = await load();
    if (res.error) {
      lastError = res.error;
      continue;
    }
    const ids = (res.data ?? []).map((x: any) => String(x.account_id ?? x.accountId)).filter(Boolean);
    if (ids.length) {
      accountIds = ids;
      break;
    }
  }

  if (!accountIds.length && lastError) return NextResponse.json({ error: lastError.message }, { status: 500 });
  accountIds = Array.from(new Set(accountIds));
  if (accountIds.length) {
    const workerIds = Array.from(new Set([workerUuidResolved, workerId].filter(Boolean)));
    const nowIso = new Date().toISOString();
    const hasFutureOpen = new Map<string, boolean>();

    let existing: any[] = [];
    let resExisting: any = await sb
      .from("work_items")
      .select("account_id,status,due_at,worker_id")
      .in("account_id", accountIds)
      .eq("worker_id", workerUuidResolved);
    if (resExisting.error && isMissingColumn(resExisting.error.message)) {
      resExisting = await sb
        .from("work_items")
        .select("accountId,status,dueAt,workerId")
        .in("accountId", accountIds)
        .eq("workerId", workerUuidResolved);
    }
    if (!resExisting.error && Array.isArray(resExisting.data)) {
      existing = resExisting.data as any[];
    }

    if (existing.length) {
      for (const row of existing) {
        const status = String(row.status ?? "").toLowerCase();
        if (status !== "open" && status !== "in progress" && status !== "needs fix") continue;
        const accountId = String(row.account_id ?? row.accountId ?? "");
        if (!accountId) continue;
        const raw = row.due_at ?? row.dueAt;
        if (!raw) continue;
        const dueIso = new Date(String(raw)).toISOString();
        if (dueIso >= nowIso) {
          hasFutureOpen.set(accountId, true);
        }
      }
    }

    for (const accountId of accountIds) {
      if (hasFutureOpen.get(accountId)) continue;
      await ensureScheduledWork(sb, accountId, workerIds);
    }
  }

  let data: any[] | null = null;
  let error: any = null;

  if (accountIds.length) {
    let res: any = { data: null, error: null };
    if (workerUuidResolved) {
      res = await sb
        .from("work_items")
        .select("*")
        .in("account_id", accountIds)
        .in("worker_id", [workerUuidResolved])
        .order("priority", { ascending: true })
        .order("due_at", { ascending: true });
    }
    if (!workerUuidResolved || (res.error && isMissingColumn(res.error.message))) {
      res = await sb
        .from("work_items")
        .select("*")
        .in("accountId", accountIds)
        .in("workerId", [workerId, workerUuidResolved].filter(Boolean))
        .order("priority", { ascending: true })
        .order("dueAt", { ascending: true });
      if (res.error && isMissingColumn(res.error.message) && workerUuidResolved) {
        res = await sb
          .from("work_items")
          .select("*")
          .in("account_id", accountIds)
          .in("worker_id", [workerUuidResolved])
          .order("priority", { ascending: true })
          .order("due_at", { ascending: true });
      }
      if (res.error && isMissingColumn(res.error.message) && !workerUuidResolved) {
        res = { data: [], error: null };
      }
    }
    data = res.data ?? null;
    error = res.error ?? null;
  } else {
    const workerIdOr = workerUuidResolved ? `worker_id.eq.${workerUuidResolved}` : "";
    const workerCodeOr = `workerId.eq.${workerId}`;
    let res: any = await sb
      .from("work_items")
      .select("*")
      .or([workerIdOr, workerCodeOr].filter(Boolean).join(","))
      .order("priority", { ascending: true })
      .order("due_at", { ascending: true });
    if (res.error && isMissingColumn(res.error.message)) {
      if (!workerUuidResolved) {
        res = { data: [], error: null };
      } else {
        res = await sb
          .from("work_items")
          .select("*")
          .or([workerCodeOr].filter(Boolean).join(","))
          .order("priority", { ascending: true })
          .order("dueAt", { ascending: true });
        if (res.error && isMissingColumn(res.error.message)) {
          res = { data: [], error: null };
        }
      }
    }
    data = res.data ?? null;
    error = res.error ?? null;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const nowUtc = new Date();
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

  const filtered =
    scope === "all"
      ? data ?? []
      : (data ?? []).filter((x) => {
          const dueRaw = x.due_at ?? x.dueAt;
          if (!dueRaw) return false;
          const sla = Number(x.sla_minutes ?? x.slaMinutes ?? 180);
          const dueUtc = parseDueToUtc(String(dueRaw));
          const windowStart = new Date(dueUtc.getTime() - sla * 60 * 1000);
          return nowUtc >= windowStart && nowUtc <= dueUtc;
        });

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

  return NextResponse.json(
    filtered
      .map((x) => {
        const id = x.id ?? x.public_id ?? x.publicId ?? "";
        if (!id) return null;
        const rawWorkerId = x.worker_id ?? x.workerId;
        const normalizedWorkerId = rawWorkerId === workerUuid ? workerId : rawWorkerId;
        return {
          id,
          workerId: normalizedWorkerId,
      title: x.title,
      type: x.type,
      accountId: x.account_id ?? x.accountId,
      createdAt: x.created_at ?? x.createdAt,
      dueAt: toIstLocal(new Date(x.due_at ?? x.dueAt)),
      status: x.status,
      priority: x.priority,
      rewardINR: x.reward_inr ?? x.rewardINR,
      estMinutes: x.est_minutes ?? x.estMinutes,
      slaMinutes: x.sla_minutes ?? x.slaMinutes,
      startedAt: (x.started_at ?? x.startedAt) ? toIstLocal(new Date(x.started_at ?? x.startedAt)) : undefined,
      completedAt: (x.completed_at ?? x.completedAt) ? toIstLocal(new Date(x.completed_at ?? x.completedAt)) : undefined,
      gates: x.gates ?? {},
      submission: x.submission ?? undefined,
      review: x.review ?? undefined,
      audit: x.audit ?? [],
        };
      })
      .filter(Boolean)
  );
}
