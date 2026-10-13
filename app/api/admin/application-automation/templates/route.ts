import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { toTemplateDto } from "@/lib/api/applicationAutomation";
import { parseTemplateInput, requireUuid } from "@/lib/api/automationInput";

export const GET = withApi({ auth: "admin" }, async () => {
  const { data, error } = await supabaseAdmin().from("application_message_templates").select("*").order("created_at");
  databaseError(error);
  return NextResponse.json({ ok: true, templates: (data ?? []).map(toTemplateDto) });
});

export const POST = withApi({ auth: "admin" }, async (req) => {
  const actor = await authenticate(req);
  const input = parseTemplateInput(await req.json());
  const { data, error } = await supabaseAdmin()
    .from("application_message_templates")
    .insert({ ...input, created_by: actor.user.id })
    .select("*")
    .single();
  databaseError(error);
  return NextResponse.json({ ok: true, template: toTemplateDto(data) }, { status: 201 });
});

export const PATCH = withApi({ auth: "admin" }, async (req) => {
  const body = await req.json();
  const id = requireUuid(body.id, "template");
  const { data, error } = await supabaseAdmin()
    .from("application_message_templates")
    .update({ ...parseTemplateInput(body), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  databaseError(error);
  if (!data) throw new ApiError(404, "Template not found.", "not_found");
  return NextResponse.json({ ok: true, template: toTemplateDto(data) });
});

export const DELETE = withApi({ auth: "admin" }, async (req) => {
  const id = requireUuid(new URL(req.url).searchParams.get("id"), "template");
  const { error } = await supabaseAdmin().from("application_message_templates").delete().eq("id", id);
  // A template referenced by a rule is protected by the foreign key (409 "still in use").
  databaseError(error);
  return NextResponse.json({ ok: true });
});
