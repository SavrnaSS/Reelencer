import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { workItemResponse } from "@/lib/api/work";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const PATCH = withApi({ auth: "user" }, async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ApiError(400, "Invalid work item ID.");
  const actor = await authenticate(req);
  const { data, error } = await supabaseAdmin().rpc("transition_work_item", {
    p_actor: actor.user.id, p_item: id, p_action: "start", p_payload: {},
  });
  databaseError(error);
  return NextResponse.json(workItemResponse(data, actor.workerCode ?? undefined));
});
