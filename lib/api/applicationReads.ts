import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ApiError, databaseError } from "./errors";

const PAGE_SIZE = 1000;
const MAX_APPLICATIONS = 100_000;
type Row = Record<string, unknown>;

/** Filter deleted owners in PostgreSQL before pagination, counts, exports and automation matching. */
export async function readCurrentApplications(sb: ReturnType<typeof supabaseAdmin>, { gigId, workerAliases }: { gigId?: string; workerAliases?: string[] } = {}) {
  const rows: Row[] = [];
  for (;;) {
    let query = sb.from("current_gig_applications").select("*")
      .order("applied_at", { ascending: false }).order("id", { ascending: false })
      .range(rows.length, rows.length + Math.min(PAGE_SIZE, MAX_APPLICATIONS - rows.length + 1) - 1);
    if (gigId) query = query.eq("gig_id", gigId);
    if (workerAliases) query = query.in("worker_code", workerAliases);
    const result = await query;
    databaseError(result.error);
    const page = (result.data ?? []) as Row[];
    if (!page.length) return rows;
    rows.push(...page);
    if (rows.length > MAX_APPLICATIONS) throw new ApiError(503, "Too many applications to load safely. Filter by a gig or worker and try again.", "application_limit");
    // A Supabase project can impose a smaller page cap; an empty follow-up proves completeness.
  }
}
