import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const POST = withApi({ auth: "user" }, async req => {
  const actor = await authenticate(req);
  const { data, error } = await supabaseAdmin().rpc("bootstrap_worker", { p_user: actor.user.id });
  databaseError(error);
  return NextResponse.json({ ...data, role: actor.isAdmin ? "Admin" : "Worker" });
});
