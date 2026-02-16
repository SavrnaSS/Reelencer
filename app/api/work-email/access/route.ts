import { getAllowedWorkEmailDomains } from "@/lib/workEmail";
import { bumpCodeUsage, json, requireUserFromBearer, tableMissing, validateActiveCode } from "../_utils";

export async function POST(req: Request) {
  const guard = await requireUserFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const body = await req.json().catch(() => ({}));
  const codeInput = String(body?.code || "");
  const valid = await validateActiveCode(guard.admin, codeInput);
  if (!valid.ok) {
    if (tableMissing(valid.error)) {
      return json(500, {
        ok: false,
        error: "Work email tables are missing. Run scripts/work-email-creator-schema.sql in Supabase SQL Editor.",
      });
    }
    return json(valid.status, { ok: false, error: valid.error });
  }

  await bumpCodeUsage(guard.admin, String(valid.code.id), Number(valid.code.use_count ?? 0));

  return json(200, {
    ok: true,
    codeId: String(valid.code.id),
    allowedDomains: getAllowedWorkEmailDomains(),
  });
}

