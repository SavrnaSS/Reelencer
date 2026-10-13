import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { baselineRule, toRuleDto } from "@/lib/api/applicationAutomation";
import { parseRuleInput, requireUuid } from "@/lib/api/automationInput";

export const GET = withApi({ auth: "admin" }, async () => {
  const { data, error } = await supabaseAdmin().from("application_automation_rules").select("*").order("created_at");
  databaseError(error);
  return NextResponse.json({ ok: true, rules: (data ?? []).map(toRuleDto) });
});

export const POST = withApi({ auth: "admin" }, async (req) => {
  const actor = await authenticate(req);
  const input = parseRuleInput(await req.json());
  const { data, error } = await supabaseAdmin()
    .from("application_automation_rules")
    .insert({ ...input, owner_id: actor.user.id, enabled: false })
    .select("*")
    .single();
  databaseError(error);
  return NextResponse.json({ ok: true, rule: toRuleDto(data) }, { status: 201 });
});

/**
 * Updates a rule. `{ id, enabled }` alone toggles auto-run; switching it on baselines every current match
 * so the scheduler only acts on applications that start matching afterwards. The enabling admin becomes the
 * rule owner the scheduler acts as.
 */
export const PATCH = withApi({ auth: "admin" }, async (req) => {
  const actor = await authenticate(req);
  const body = await req.json();
  const id = requireUuid(body.id, "rule");
  const sb = supabaseAdmin();
  const toggleOnly = Object.keys(body).every((k) => k === "id" || k === "enabled");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (!toggleOnly) Object.assign(patch, parseRuleInput(body));
  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled;
    if (body.enabled) patch.owner_id = actor.user.id;
  }
  const { data, error } = await sb.from("application_automation_rules").update(patch).eq("id", id).select("*").maybeSingle();
  databaseError(error);
  if (!data) throw new ApiError(404, "Rule not found.", "not_found");
  const rule = toRuleDto(data);
  const baselined = body.enabled === true ? await baselineRule(rule) : 0;
  return NextResponse.json({ ok: true, rule, baselined });
});

export const DELETE = withApi({ auth: "admin" }, async (req) => {
  const id = requireUuid(new URL(req.url).searchParams.get("id"), "rule");
  const { error } = await supabaseAdmin().from("application_automation_rules").delete().eq("id", id);
  databaseError(error);
  return NextResponse.json({ ok: true });
});
