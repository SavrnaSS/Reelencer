import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { assignedAccounts } from "@/lib/api/work";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function handleGET(req: Request) {
  const actor = await authenticate(req);
  const sb = supabaseAdmin();
  const accountIds = actor.isAdmin ? null : (await assignedAccounts(actor.user.id)).map(row => row.account_id);
  if (accountIds && !accountIds.length) return NextResponse.json([]);
  let query = sb.from("accounts").select("*").order("id");
  if (accountIds) query = query.in("id", accountIds);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    (data ?? []).map((a) => ({
      id: a.id,
      handle: a.handle,
      niche: a.niche,
      ownerTeam: a.ownerTeam ?? a.owner_team ?? "",
      policyTier: a.policyTier ?? a.policy_tier ?? "Standard",
      health: a.health ?? "Healthy",
      rules: a.rules ?? [],
      allowedAudios: a.allowedAudios ?? a.allowed_audios ?? [],
      requiredHashtags: a.requiredHashtags ?? a.required_hashtags ?? [],
    }))
  );
}

export const GET = withApi({ auth: "user" }, handleGET);
