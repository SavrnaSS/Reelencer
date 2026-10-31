import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/route";
import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isDashboardDevMode, reorderDevDashboardGigs } from "@/lib/dashboardDevData";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const orderInput = z.object({
  ids: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)).min(1).max(1000)
    .refine(ids => new Set(ids).size === ids.length, "Each gig can appear only once."),
});

/** Save the order creators see gigs in: `ids` top to bottom. Gigs left out keep their place after the listed ones. */
async function handlePUT(req: Request) {
  const parsed = orderInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Send the gigs in their new order.", "invalid_gig_order");
  const { ids } = parsed.data;
  if (isDashboardDevMode()) {
    return NextResponse.json({ ok: true, changed: reorderDevDashboardGigs(ids) }, { headers: NO_STORE_HEADERS });
  }
  const { data, error } = await supabaseAdmin().rpc("reorder_gigs", { p_ids: ids });
  if (error) {
    // PGRST202/42883/42703: the feed-order migration (202610310007) has not been applied to this database yet.
    if (["PGRST202", "42883", "42703"].includes(error.code ?? "")) {
      throw new ApiError(503, "Feed ordering isn't switched on yet. Apply the latest database update, then try again.", "feed_order_unavailable");
    }
    throw new ApiError(500, "The gig order could not be saved. Please try again.");
  }
  return NextResponse.json({ ok: true, changed: Number(data ?? 0) }, { headers: NO_STORE_HEADERS });
}

export const PUT = withApi({ auth: "admin", rateLimit: 60 }, handlePUT);
