import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

const DEFAULT_RULES = ["Use caption template", "No politics/religion"];
const DEFAULT_AUDIOS = ["Calm Beat #2", "Soft Pop #3"];
const DEFAULT_HASHTAGS = ["#brand", "#reels"];

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const sb = supabaseAdmin();
  const accountsRes = await sb.from("accounts").select("*");
  if (accountsRes.error) return json(500, { ok: false, error: accountsRes.error.message });

  const isMissingColumn = (msg?: string | null) => {
    if (!msg) return false;
    return (
      (msg.includes("column") && msg.includes("does not exist")) ||
      (msg.includes("Could not find the") && msg.includes("column")) ||
      msg.includes("schema cache")
    );
  };

  const stripMissing = (payload: Record<string, any>, msg?: string | null) => {
    if (!msg) return payload;
    const match = msg.match(/column ['"]?([a-zA-Z0-9_]+)['"]?/);
    const col = match?.[1];
    if (!col) return payload;
    const next = { ...payload };
    delete next[col];
    return next;
  };

  const updateRow = async (id: string, payload: Record<string, any>) => {
    let nextPayload = payload;
    for (let i = 0; i < 6; i += 1) {
      const res = await sb.from("accounts").update(nextPayload).eq("id", id);
      if (!res.error) return { ok: true };
      if (!isMissingColumn(res.error.message)) return { ok: false, error: res.error.message };
      const stripped = stripMissing(nextPayload, res.error.message);
      if (Object.keys(stripped).length === Object.keys(nextPayload).length) return { ok: false, error: res.error.message };
      nextPayload = stripped;
    }
    const res = await sb.from("accounts").update(nextPayload).eq("id", id);
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true };
  };

  let updated = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const a of accountsRes.data ?? []) {
    const handleRaw = String(a.handle ?? "");
    const handle = handleRaw && !handleRaw.startsWith("@") ? `@${handleRaw}` : handleRaw;
    const ownerTeam = String(a.ownerTeam ?? a.owner_team ?? "");
    const policyTier = String(a.policyTier ?? a.policy_tier ?? "Standard");
    const health = String(a.health ?? "Healthy");
    const rules = Array.isArray(a.rules) && a.rules.length ? a.rules : DEFAULT_RULES;
    const allowedAudios = Array.isArray(a.allowedAudios ?? a.allowed_audios) && (a.allowedAudios ?? a.allowed_audios).length ? (a.allowedAudios ?? a.allowed_audios) : DEFAULT_AUDIOS;
    const requiredHashtags =
      Array.isArray(a.requiredHashtags ?? a.required_hashtags) && (a.requiredHashtags ?? a.required_hashtags).length
        ? (a.requiredHashtags ?? a.required_hashtags)
        : DEFAULT_HASHTAGS;

    const payload = {
      handle,
      ownerTeam,
      owner_team: ownerTeam,
      policyTier,
      policy_tier: policyTier,
      health,
      rules,
      allowedAudios,
      allowed_audios: allowedAudios,
      requiredHashtags,
      required_hashtags: requiredHashtags,
    };

    const res = await updateRow(String(a.id), payload);
    if (res.ok) updated += 1;
    else errors.push({ id: String(a.id), error: res.error ?? "Unknown error" });
  }

  return json(200, { ok: true, updated, errors });
}
