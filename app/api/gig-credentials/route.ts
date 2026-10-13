import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encryptSecretText, decryptSecretText } from "@/lib/secretCrypto";

export const GET = withApi({ auth: "user", assignment: true }, async req => {
  const id = new URL(req.url).searchParams.get("assignmentId")!;
  const { data, error } = await supabaseAdmin().from("gig_account_credentials").select("id,assignment_id,handle,email,password,phone").eq("assignment_id", id).order("created_at");
  databaseError(error);
  return NextResponse.json((data ?? []).map(row => ({
    id: row.id, assignmentId: row.assignment_id, handle: row.handle, email: row.email, phone: row.phone ?? undefined,
    password: decryptSecretText(row.password),
  })));
});
const credentials = z.object({
  assignmentId: z.uuid(),
  accounts: z.array(z.object({
    handle: z.string().trim().min(1).max(120), email: z.email().max(254),
    password: z.string().min(1).max(1024), phone: z.string().max(30).nullable().optional(),
  })).length(5),
});
export const POST = withApi({ auth: "user", assignment: true, rateLimit: 10 }, async req => {
  const parsed = credentials.safeParse(await req.json());
  if (!parsed.success) throw new ApiError(400, "Submit five complete accounts with valid email addresses.");
  const actor = await authenticate(req);
  const rows = parsed.data.accounts.map(row => ({ ...row, email: row.email.toLowerCase(), password: encryptSecretText(row.password) }));
  const { error } = await supabaseAdmin().rpc("submit_gig_credentials", { p_actor: actor.user.id, p_assignment: parsed.data.assignmentId, p_accounts: rows });
  databaseError(error);
  return NextResponse.json({ ok: true });
});
