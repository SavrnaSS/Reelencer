import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAdminCredentials } from "./adminConfig";

type Credentials = ReturnType<typeof getAdminCredentials>;

export class AdminSetupError extends Error {
  constructor(message: string, public readonly authUpdated = false) {
    super(message);
    this.name = "AdminSetupError";
  }
}

async function findUser(sb: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; page <= 1000; page++) {
    const result = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new AdminSetupError("Cannot read Supabase Auth users. Check project connectivity and the server service key.");
    const found = result.data.users.find(user => user.email?.trim().toLowerCase() === email);
    if (found) return found;
    if (result.data.users.length < 1000) return null;
  }
  throw new AdminSetupError("The Auth user directory exceeded the setup scan limit.");
}

/** Explicit operator action: does not run during login, server startup, or page requests. */
export async function syncAdminAccount(sb: SupabaseClient, credentials: Credentials, apply: boolean) {
  const version = await sb.rpc("reelencer_backend_version");
  if (version.error || version.data !== 3) throw new AdminSetupError("Admin setup requires a reachable Supabase project and all database migrations. Run npm run db:migrate first.");
  const owner = await sb.from("admin_owner").select("user_id,email").eq("singleton", true).maybeSingle();
  if (owner.error) throw new AdminSetupError("Cannot read administrator configuration. Verify the admin identity migration and service permissions.");
  const existing = await findUser(sb, credentials.email);
  if (existing?.banned_until && Date.parse(existing.banned_until) > Date.now()) {
    throw new AdminSetupError("The configured Auth account is suspended. Resolve the suspension before provisioning it.");
  }
  if (!apply) {
    const permission = await sb.rpc("admin_configuration_ready", { p_email: credentials.email });
    if (permission.error) throw new AdminSetupError("Cannot verify the database administrator configuration.");
    return { mode: "check", accountExists: Boolean(existing), administratorMatches: permission.data === true && owner.data?.user_id === existing?.id, passwordChecked: false };
  }

  const attributes = {
    password: credentials.password,
    email_confirm: true,
    user_metadata: { ...(existing?.user_metadata ?? {}), name: credentials.name },
  };
  const auth = existing
    ? await sb.auth.admin.updateUserById(existing.id, attributes)
    : await sb.auth.admin.createUser({ ...attributes, email: credentials.email });
  if (auth.error || !auth.data.user) throw new AdminSetupError("Supabase Auth could not save the administrator credentials. Check its password policy, project availability, and service permissions.");

  const saved = await sb.rpc("configure_admin_owner", {
    p_user: auth.data.user.id,
    p_email: credentials.email,
    p_name: credentials.name,
    p_expected_owner: owner.data?.user_id ?? null,
  });
  if (saved.error) {
    // A timeout may hide a committed transaction. Never delete the user or undo another operator's setup.
    throw new AdminSetupError("Auth credentials were saved, but database ownership could not be confirmed. Review the administrator configuration and rerun admin:sync.", true);
  }
  const verified = await sb.rpc("admin_configuration_ready", { p_email: credentials.email });
  if (verified.error || verified.data !== true) throw new AdminSetupError("Credentials were saved, but the administrator readiness check failed. Run admin:check before using the account.", true);
  return { mode: "sync", configured: true, created: !existing, userId: auth.data.user.id };
}
