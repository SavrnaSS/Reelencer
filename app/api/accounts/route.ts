import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("accounts").select("*").order("id");
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
