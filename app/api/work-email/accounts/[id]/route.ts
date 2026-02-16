import { getSecretCodeFromHeaders, json, requireUserFromBearer, tableMissing, validateActiveCode } from "../../_utils";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireUserFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const code = getSecretCodeFromHeaders(req);
  const valid = await validateActiveCode(guard.admin, code);
  if (!valid.ok) {
    if (tableMissing(valid.error)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(valid.status, { ok: false, error: valid.error });
  }

  const { id } = await ctx.params;
  const { error } = await guard.admin
    .from("work_email_accounts")
    .update({ status: "deleted", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_user_id", guard.userId)
    .eq("secret_code_id", String(valid.code.id));

  if (error) {
    if (tableMissing(error.message)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(500, { ok: false, error: error.message });
  }

  return json(200, { ok: true });
}

