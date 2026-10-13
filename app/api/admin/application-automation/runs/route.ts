import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { toRunDto } from "@/lib/api/applicationAutomation";

export const GET = withApi({ auth: "admin" }, async () => {
  const { data, error } = await supabaseAdmin().from("application_automation_runs").select("*").order("started_at", { ascending: false }).limit(50);
  databaseError(error);
  return NextResponse.json({ ok: true, runs: (data ?? []).map(toRunDto) });
});
