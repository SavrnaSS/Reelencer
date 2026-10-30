import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { databaseError } from "@/lib/api/errors";

export type AdminPendingUpiConfig = {
  workerId: string;
  workerCode: string;
  workerName: string;
  upiId: string;
  verified: false;
  updatedAt?: string;
  payoutSchedule: string;
  payoutDay: string;
};

type PendingRow = {
  worker_id: string;
  upi_id: string;
  updated_at: string | null;
  payout_schedule: string | null;
  payout_day: string | null;
  profile: { worker_code: string; display_name: string | null };
};

const PAGE_SIZE = 200;

/** Count the live eligible queue, independently of the small dashboard preview. */
export async function loadAdminPendingUpiQueue(sb: SupabaseClient, limit: number) {
  let pendingCount = 0;
  let cursor: string | undefined;
  let upiConfigs: AdminPendingUpiConfig[] = [];
  for (;;) {
    let query = sb.from("upi_configs")
      .select("worker_id,upi_id,updated_at,payout_schedule,payout_day,profile:profiles!inner(worker_code,display_name,role,active)")
      .eq("verified", false).neq("upi_id", "")
      .eq("profile.role", "Worker").eq("profile.active", true)
      .order("worker_id", { ascending: true }).limit(PAGE_SIZE);
    // Immutable-key pagination avoids skips when a save changes a row's timestamp.
    if (cursor) query = query.gt("worker_id", cursor);
    const result = await query;
    databaseError(result.error);
    const rows = (result.data ?? []) as unknown as PendingRow[];
    if (!rows.length) break;
    const ids = rows.map(row => row.worker_id);
    const [workers, moderation] = await Promise.all([
      sb.from("workers").select("user_id").in("user_id", ids).eq("active", false),
      sb.from("worker_moderation").select("user_id").in("user_id", ids).neq("status", "active"),
    ]);
    databaseError(workers.error);
    databaseError(moderation.error);
    const excluded = new Set([...workers.data ?? [], ...moderation.data ?? []].map(row => String(row.user_id)));
    const eligible = rows.filter(row => !excluded.has(row.worker_id) && row.profile && row.upi_id.trim());
    pendingCount += eligible.length;
    upiConfigs = [...upiConfigs, ...eligible.map(row => ({
      workerId: row.worker_id,
      workerCode: row.profile.worker_code || row.worker_id,
      workerName: row.profile.display_name?.trim() || row.profile.worker_code || "Creator",
      upiId: row.upi_id,
      verified: false as const,
      updatedAt: row.updated_at ?? undefined,
      payoutSchedule: row.payout_schedule ?? "Weekly",
      payoutDay: row.payout_day ?? "Fri",
    }))].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.workerId.localeCompare(b.workerId)).slice(0, limit);
    if (rows.length < PAGE_SIZE) break;
    cursor = rows[rows.length - 1].worker_id;
  }
  return { pendingCount, upiConfigs };
}
