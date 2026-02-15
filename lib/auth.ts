import { supabaseAdmin } from "./supabaseAdmin";
import { isRole, type AppRole } from "./roles";

export async function getRoleForUser(userId: string): Promise<AppRole | null> {
  const { data, error } = await supabaseAdmin().from("profiles").select("role").eq("id", userId).maybeSingle();
  if (error) return null;
  const role = data?.role;
  return isRole(role) ? role : null;
}

export async function getWorkerIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from("workers").select("id").eq("user_id", userId).maybeSingle();
  if (error) return null;
  return data?.id ?? null;
}
