import { decryptSecretText } from "@/lib/secretCrypto";
import { json, requireAdminFromBearer, supabaseAdmin } from "../../_utils";

function missingSchema(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("relation") ||
    lower.includes("undefined table") ||
    lower.includes("schema cache") ||
    lower.includes("could not find the table") ||
    lower.includes("column")
  );
}

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  if (!id) return json(400, { ok: false, error: "id is required." });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("work_email_accounts")
    .select("id,social_password")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    if (missingSchema(error.message)) return json(500, { ok: false, error: "Missing work email schema." });
    return json(500, { ok: false, error: error.message });
  }
  if (!data) return json(404, { ok: false, error: "Work email record not found." });

  const stored = String((data as { social_password?: string | null }).social_password ?? "");
  if (!stored) return json(200, { ok: true, password: "" });

  try {
    const plain = decryptSecretText(stored);
    return json(200, { ok: true, password: plain });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unable to decrypt password.";
    return json(500, { ok: false, error: msg });
  }
}

