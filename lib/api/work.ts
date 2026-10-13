import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ApiError, databaseError } from "./errors";

export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function resolveWorkerUserId(value: string) {
  if (isUuid(value)) return value;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new ApiError(400, "Invalid worker ID.");
  const { data, error } = await supabaseAdmin().from("profiles").select("id").eq("worker_code", value).maybeSingle();
  databaseError(error);
  if (!data) throw new ApiError(404, "Worker not found.");
  return String(data.id);
}

export async function assignedAccounts(userId: string) {
  const sb = supabaseAdmin();
  const results = await Promise.all([
    sb.from("assignments").select("account_id,schedule").eq("worker_id", userId),
    sb.from("worker_account_assignments").select("account_id,schedule").eq("worker_id", userId),
    sb.from("worker_accounts").select("account_id").eq("worker_id", userId),
  ]);
  const accounts = new Map<string, { account_id: string; schedule?: unknown }>();
  for (const result of results) {
    databaseError(result.error);
    for (const row of result.data ?? []) if (!accounts.has(row.account_id)) accounts.set(row.account_id, row);
  }
  return [...accounts.values()];
}

function localStamp(raw: unknown) {
  if (!raw) return undefined;
  const date = new Date(String(raw));
  if (!Number.isFinite(date.getTime())) return undefined;
  // Preserve the workspace's existing India-local display contract.
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 16);
}
export function workItemResponse(row: Record<string, unknown>, workerId?: string) {
  return {
    id: row.id, publicId: row.public_id, workerId: workerId ?? row.worker_id,
    title: row.title, type: row.type, accountId: row.account_id, createdAt: row.created_at,
    dueAt: localStamp(row.due_at), status: row.status, priority: row.priority,
    rewardINR: Number(row.reward_inr), estMinutes: row.est_minutes, slaMinutes: row.sla_minutes,
    startedAt: localStamp(row.started_at), completedAt: localStamp(row.completed_at),
    gates: row.gates ?? {}, submission: row.submission ?? undefined, review: row.review ?? undefined, audit: row.audit ?? [],
  };
}
