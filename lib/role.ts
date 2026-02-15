// lib/role.ts
import { supabase } from "@/lib/supabaseClient";

export type Role = "Admin" | "Worker";

export async function getMyRole(): Promise<Role | null> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || !profile?.role) return null;
  return profile.role as Role;
}
