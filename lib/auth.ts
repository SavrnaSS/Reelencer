import { supabaseAdmin } from "./supabaseAdmin";
import { isAdminOwnerEmail } from "./adminOwner";
import { normalizeRole, type AppRole } from "./roles";

export async function getRoleForUser(userId: string): Promise<AppRole | null> {
  const admin = supabaseAdmin();
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  if (!authUser.user?.email_confirmed_at || authUser.user.is_anonymous) return null;
  if (isAdminOwnerEmail(authUser.user.email)) {
    const permission = await admin.rpc("app_is_admin", { p_actor: userId });
    if (permission.error) return null;
    if (permission.data === true) return "admin";
  }

  const { data, error } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (error) return null;
  const role = normalizeRole(data?.role);
  if (!role) return null;
  return role === "admin" ? "worker" : role;
}

export async function getWorkerIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from("workers").select("id").eq("user_id", userId).maybeSingle();
  if (error) return null;
  return data?.id ?? null;
}
