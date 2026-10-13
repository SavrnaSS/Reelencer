import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { authenticate, workerFilter } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { resolveWorkerUserId, workItemResponse } from "@/lib/api/work";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const GET = withApi({ auth: "user" }, async req => {
  const actor = await authenticate(req);
  const query = new URL(req.url).searchParams;
  const worker = workerFilter(actor, query.get("workerId")) ?? actor.user.id;
  const userId = actor.isAdmin ? await resolveWorkerUserId(worker) : actor.user.id;
  const offset = Number(query.get("offset") ?? 0);
  const limit = Number(query.get("limit") ?? 1000);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new ApiError(400, "Invalid pagination.");
  // Reading work never generates or deletes assignments.
  const { data, error, count } = await supabaseAdmin().from("work_items").select("*", { count: "exact" })
    .eq("worker_id", userId).order("due_at").order("id").range(offset, offset + limit - 1);
  databaseError(error);
  const now = Date.now();
  const rows = query.get("scope") === "all" ? data ?? [] : (data ?? []).filter(row => {
    const due = new Date(row.due_at).getTime();
    return now >= due - Number(row.sla_minutes ?? 180) * 60_000 && now <= due;
  });
  return NextResponse.json(rows.map(row => workItemResponse(row, worker)), { headers: { "X-Total-Count": String(count ?? 0) } });
});
