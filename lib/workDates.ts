const IST_OFFSET_MINUTES = 330;
const MINUTE_MS = 60_000;

export type WorkTiming = {
  dueInMin?: number;
  overdue: boolean;
  slaRemaining?: number;
  slaBreached?: boolean;
};

/** Work APIs return India-local timestamps without an offset, or ISO timestamps. */
export function parseWorkDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/i.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "0", fraction = "", zone] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [y, m, d, hh, mm, ss] = parts;
  const local = new Date(0);
  local.setUTCFullYear(y, m - 1, d);
  local.setUTCHours(hh, mm, ss, Number(fraction.slice(1, 4).padEnd(3, "0")));
  // Reject rolled-over dates and times rather than turning them into real deadlines.
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== m - 1 || local.getUTCDate() !== d ||
      local.getUTCHours() !== hh || local.getUTCMinutes() !== mm || local.getUTCSeconds() !== ss) return null;

  let offset = IST_OFFSET_MINUTES;
  if (zone?.toUpperCase() === "Z") offset = 0;
  else if (zone) {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offset = (zone[0] === "+" ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  }
  return new Date(local.getTime() - offset * MINUTE_MS);
}

export function formatWorkDeadline(value: unknown, includeTimezone = false): string {
  const date = parseWorkDate(value);
  if (!date) return "No deadline";
  const local = new Date(date.getTime() + IST_OFFSET_MINUTES * MINUTE_MS).toISOString().slice(0, 16).replace("T", " ");
  return includeTimezone ? `${local} Asia/Kolkata` : local;
}

/** Missing deadlines sort after scheduled work, preserving their original order. */
export function compareWorkDeadlines(left: unknown, right: unknown): number {
  const a = parseWorkDate(left);
  const b = parseWorkDate(right);
  if (!a) return b ? 1 : 0;
  if (!b) return -1;
  return a.getTime() - b.getTime();
}

export function workDurationMinutes(start: unknown, end: unknown): number | undefined {
  const started = parseWorkDate(start);
  const completed = parseWorkDate(end);
  if (!started || !completed || completed < started) return undefined;
  return Math.floor((completed.getTime() - started.getTime()) / MINUTE_MS);
}

export function getWorkTiming(item: {
  dueAt?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  slaMinutes?: number;
  status: string;
}, now = new Date()): WorkTiming {
  const due = parseWorkDate(item.dueAt);
  const dueInMin = due ? Math.floor((due.getTime() - now.getTime()) / MINUTE_MS) : undefined;
  const overdue = dueInMin !== undefined && dueInMin < 0 &&
    ["Open", "In progress", "Needs fix", "Submitted"].includes(item.status);
  const timing: WorkTiming = { dueInMin, overdue };
  const started = parseWorkDate(item.startedAt);
  if (started && typeof item.slaMinutes === "number" && Number.isFinite(item.slaMinutes) && item.slaMinutes > 0 &&
      ["In progress", "Submitted", "Approved", "Needs fix"].includes(item.status)) {
    const end = parseWorkDate(item.completedAt) ?? now;
    const elapsed = Math.max(0, Math.floor((end.getTime() - started.getTime()) / MINUTE_MS));
    timing.slaRemaining = item.slaMinutes - elapsed;
    timing.slaBreached = timing.slaRemaining < 0 && item.status === "In progress";
  }
  return timing;
}
