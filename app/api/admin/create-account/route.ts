// app/api/admin/create-account/route.ts
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

type PolicyTier = "Standard" | "Strict";
type AccountHealth = "Healthy" | "Watch" | "Risk";

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { ok: false, error: "Invalid JSON" });

  const {
    id,
    handle,
    niche,
    ownerTeam,
    policyTier,
    health,
    rules,
    allowedAudios,
    requiredHashtags,
  }: {
    id: string;
    handle: string;
    niche: string;
    ownerTeam: string;
    policyTier: PolicyTier;
    health: AccountHealth;
    rules: string[];
    allowedAudios: string[];
    requiredHashtags: string[];
  } = body;

  if (!id?.trim() || !handle?.trim() || !niche?.trim() || !ownerTeam?.trim()) {
    return json(400, { ok: false, error: "Missing required fields" });
  }

  const sb = supabaseAdmin();

  // enforce unique id/handle (case-insensitive handle check)
  const { data: existing, error: exErr } = await sb
    .from("accounts")
    .select("id, handle")
    .or(`id.eq.${id},handle.ilike.${handle}`)
    .limit(5);

  if (exErr) return json(500, { ok: false, error: exErr.message });
  if ((existing ?? []).length) return json(409, { ok: false, error: "Account id/handle already exists" });

  const base = {
    id: id.trim(),
    handle: handle.trim(),
    niche: niche.trim(),
    policyTier,
    health,
    rules: Array.isArray(rules) ? rules : [],
    allowedAudios: Array.isArray(allowedAudios) ? allowedAudios : [],
    requiredHashtags: Array.isArray(requiredHashtags) ? requiredHashtags : [],
  };

  const camel = {
    ...base,
    ownerTeam: ownerTeam.trim(),
  };
  const snake = {
    ...base,
    owner_team: ownerTeam.trim(),
    policy_tier: policyTier,
    allowed_audios: base.allowedAudios,
    required_hashtags: base.requiredHashtags,
  };

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

  const tryInsert = async (payload: Record<string, any>) => {
    let nextPayload = payload;
    for (let i = 0; i < 6; i += 1) {
      const res = await sb.from("accounts").insert(nextPayload).select("*").single();
      if (!res.error) return res;
      if (!isMissingColumn(res.error.message)) return res;
      const stripped = stripMissing(nextPayload, res.error.message);
      if (Object.keys(stripped).length === Object.keys(nextPayload).length) return res;
      nextPayload = stripped;
    }
    return sb.from("accounts").insert(nextPayload).select("*").single();
  };

  let ins = await tryInsert(snake);
  if (ins.error && isMissingColumn(ins.error.message)) {
    ins = await tryInsert(camel);
  }
  if (ins.error) return json(500, { ok: false, error: ins.error.message });

  const a = ins.data as any;
  const account = {
    id: String(a.id),
    handle: String(a.handle ?? ""),
    niche: String(a.niche ?? ""),
    ownerTeam: String(a.ownerTeam ?? a.owner_team ?? ""),
    policyTier: (a.policyTier ?? a.policy_tier ?? "Standard") as PolicyTier,
    health: (a.health ?? "Healthy") as AccountHealth,
    rules: Array.isArray(a.rules) ? a.rules : [],
    allowedAudios: Array.isArray(a.allowedAudios ?? a.allowed_audios) ? (a.allowedAudios ?? a.allowed_audios) : [],
    requiredHashtags: Array.isArray(a.requiredHashtags ?? a.required_hashtags) ? (a.requiredHashtags ?? a.required_hashtags) : [],
  };

  return json(200, { ok: true, account });
}
