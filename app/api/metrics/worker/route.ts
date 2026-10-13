import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { authenticate, workerFilter } from "@/lib/api/auth";
import { resolveWorkerUserId } from "@/lib/api/work";
import { databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { availableWalletBalance } from "@/lib/api/wallet";

export const GET = withApi({ auth: "user" }, async req => {
  const actor = await authenticate(req);
  const worker = workerFilter(actor, new URL(req.url).searchParams.get("workerId")) ?? actor.user.id;
  const userId = actor.isAdmin ? await resolveWorkerUserId(worker) : actor.user.id;
  const [metrics, balance] = await Promise.all([
    supabaseAdmin().rpc("worker_metrics", { p_worker: userId }),
    availableWalletBalance(userId),
  ]);
  databaseError(metrics.error);
  return NextResponse.json({ ...metrics.data, money: { ...metrics.data?.money, ...balance } });
});
