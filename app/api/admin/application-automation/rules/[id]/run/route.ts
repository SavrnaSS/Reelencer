import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { runRule, toRuleDto } from "@/lib/api/applicationAutomation";
import { requireUuid } from "@/lib/api/automationInput";

// Manual "Run now": applies the rule to every current match (capped) as the calling admin.
export const POST = withApi<{ params: Promise<{ id: string }> }>({ auth: "admin", rateLimit: 10 }, async (req, { params }) => {
  const actor = await authenticate(req);
  const id = requireUuid((await params).id, "rule");
  const { data, error } = await supabaseAdmin().from("application_automation_rules").select("*").eq("id", id).maybeSingle();
  databaseError(error);
  if (!data) throw new ApiError(404, "Rule not found.", "not_found");
  const summary = await runRule(toRuleDto(data), { trigger: "manual", actorId: actor.user.id, mode: "all" });
  return NextResponse.json({ ok: true, ...summary });
});
