import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { databaseError } from "./errors";

/** Match the withdrawal transaction: only approved credits without a non-failed reservation are available. */
export async function availableWalletBalance(workerId: string) {
  const sb = supabaseAdmin();
  const pageSize = 1000;
  const credits: Array<{ id: string; reward_inr: number | string }> = [];
  const reserved = new Set<string>();
  await Promise.all([
    (async () => {
      for (let from = 0; ; from += pageSize) {
        const result = await sb.from("work_items").select("id,reward_inr").eq("worker_id", workerId)
          .eq("status", "Approved").gt("reward_inr", 0).order("id").range(from, from + pageSize - 1);
        databaseError(result.error);
        credits.push(...(result.data ?? []));
        if ((result.data?.length ?? 0) < pageSize) break;
      }
    })(),
    (async () => {
      for (let from = 0; ; from += pageSize) {
        const result = await sb.from("payout_items").select("id,work_item_id").eq("worker_id", workerId)
          .neq("status", "Failed").order("id").range(from, from + pageSize - 1);
        databaseError(result.error);
        for (const item of result.data ?? []) reserved.add(item.work_item_id);
        if ((result.data?.length ?? 0) < pageSize) break;
      }
    })(),
  ]);
  let available = 0;
  let committed = 0;
  for (const credit of credits) {
    const paise = Math.round(Number(credit.reward_inr) * 100);
    if (reserved.has(credit.id)) committed += paise;
    else available += paise;
  }
  return { available: available / 100, committed: committed / 100 };
}
