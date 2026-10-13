import "server-only";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminOwnerEmail } from "@/lib/adminOwner";
import { ApiError, databaseError } from "./errors";

export type Actor = {
  user: User;
  isAdmin: boolean;
  workerCode: string | null;
  aliases: string[];
};
const actors = new WeakMap<Request, Promise<Actor>>();

export function shareAuthentication(source: Request, target: Request) {
  const actor = actors.get(source);
  if (actor) actors.set(target, actor);
}

export function authenticate(req: Request): Promise<Actor> {
  let result = actors.get(req);
  if (!result) {
    result = resolveActor(req);
    actors.set(req, result);
  }
  return result;
}

async function resolveActor(req: Request): Promise<Actor> {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new ApiError(401, "Sign in to continue.", "unauthorized");
  const sb = supabaseAdmin();
  const { data, error } = await sb.auth.getUser(token);
  if (error && (!error.status || error.status >= 500)) throw new ApiError(503, "Authentication is temporarily unavailable.", "auth_unavailable");
  if (error || !data.user || !data.user.email_confirmed_at || data.user.is_anonymous) {
    throw new ApiError(401, "A verified session is required.", "unauthorized");
  }
  const user = data.user;
  const [profile, worker] = await Promise.all([
    sb.from("profiles").select("worker_code,active").eq("id", user.id).maybeSingle(),
    sb.from("workers").select("id,active").eq("user_id", user.id).maybeSingle(),
  ]);
  databaseError(profile.error);
  databaseError(worker.error);
  if (profile.data?.active === false || worker.data?.active === false) {
    throw new ApiError(403, "This account is inactive.", "account_inactive");
  }
  let isAdmin = false;
  if (isAdminOwnerEmail(user.email)) {
    // Both the server environment and the service-managed database identity must agree.
    const permission = await sb.rpc("app_is_admin", { p_actor: user.id });
    databaseError(permission.error);
    isAdmin = permission.data === true;
  }
  return {
    user,
    isAdmin,
    workerCode: profile.data?.worker_code ?? worker.data?.id ?? null,
    aliases: [...new Set([user.id, profile.data?.worker_code, worker.data?.id].filter((v): v is string => !!v))],
  };
}

export function assertWorkerAccess(actor: Actor, workerId: unknown) {
  if (actor.isAdmin) return;
  const value = String(workerId ?? "");
  // Email aliases are accepted only for the caller's verified Auth email, never editable metadata.
  if (!actor.aliases.includes(value) && value.toLowerCase() !== actor.user.email?.toLowerCase()) {
    throw new ApiError(403, "You can only access your own work.", "forbidden");
  }
}

export function workerFilter(actor: Actor, requested?: string | null) {
  if (requested) assertWorkerAccess(actor, requested);
  return actor.isAdmin ? requested || undefined : actor.workerCode ?? actor.user.id;
}

export async function requireAssignment(req: Request, assignmentId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(assignmentId)) throw new ApiError(400, "Invalid assignment ID.");
  const actor = await authenticate(req);
  const { data, error } = await supabaseAdmin().from("gig_assignments").select("*").eq("id", assignmentId).maybeSingle();
  databaseError(error);
  if (!data || (!actor.isAdmin && !actor.aliases.includes(String(data.worker_code)))) throw new ApiError(404, "Assignment not found.", "not_found");
  return data;
}
