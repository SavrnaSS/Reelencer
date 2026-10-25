import "server-only";
import { publicClientIp } from "@/lib/api/clientIp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ApiError, databaseError } from "./errors";
import { isUuid } from "./work";
import { workerPurgeAfter } from "@/lib/workerDeletion";

export type WorkerModerationStatus = "active" | "suspended" | "deleted";
export type WorkerModerationAction = "suspend" | "suspend_ip" | "restore" | "delete" | "unblock_ip";
export type WorkerModerationInput = {
  action: WorkerModerationAction;
  reason: string;
  confirmation?: string;
  ip?: string;
};
export type WorkerModerationSummary = {
  status: WorkerModerationStatus;
  reason: string | null;
  suspendedAt: string | null;
  deletedAt: string | null;
  purgeAfter: string | null;
  purgeStartedAt: string | null;
  cleanupStatus: "scheduled" | "processing" | "retry" | null;
  cleanupRetryAt: string | null;
  lastSeenAt: string | null;
  knownIps: { ip: string; lastSeenAt: string; blocked: boolean }[];
  history: { id: string; action: WorkerModerationAction; reason: string; createdAt: string; actorLabel: string }[];
};

type AdminClient = ReturnType<typeof supabaseAdmin>;
type Target = { id: string; workerCode: string; active: boolean };
const actions = new Set<WorkerModerationAction>(["suspend", "suspend_ip", "restore", "delete", "unblock_ip"]);

/** Validate before the transaction; SQL repeats every authorization and transition guard. */
export function validateWorkerModerationInput(input: unknown): WorkerModerationInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "A moderation action is required.", "invalid_moderation_action");
  const body = input as Record<string, unknown>;
  if (typeof body.action !== "string" || !actions.has(body.action as WorkerModerationAction)) throw new ApiError(400, "Choose a valid moderation action.", "invalid_moderation_action");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 8 || reason.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) {
    throw new ApiError(400, "Enter a reason between 8 and 1,000 characters.", "moderation_reason_required");
  }
  const action = body.action as WorkerModerationAction;
  const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : undefined;
  if (action === "delete" && (!confirmation || confirmation.length > 80)) throw new ApiError(400, "Type the worker ID to confirm deletion.", "moderation_confirmation_required");
  const ip = body.ip == null ? undefined : publicClientIp(body.ip);
  if ((action === "suspend_ip" || action === "unblock_ip") && !ip) throw new ApiError(400, "Select a captured public IP address.", "invalid_worker_ip");
  return { action, reason, confirmation, ...(ip ? { ip } : {}) };
}

async function resolveTarget(sb: AdminClient, workerId: string): Promise<Target> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(workerId)) throw new ApiError(400, "Invalid worker ID.", "invalid_worker_id");
  let userId = isUuid(workerId) ? workerId : undefined;
  let workerRow: { id?: string; user_id?: string; active?: boolean } | null = null;
  if (!userId) {
    const worker = await sb.from("workers").select("id,user_id,active").eq("id", workerId).maybeSingle();
    databaseError(worker.error);
    workerRow = worker.data;
    userId = worker.data?.user_id;
  }
  const profile = await sb.from("profiles").select("id,role,worker_code,active")
    .eq(userId ? "id" : "worker_code", userId ?? workerId).maybeSingle();
  databaseError(profile.error);
  if (!profile.data || profile.data.role !== "Worker") throw new ApiError(404, "Worker not found.", "not_found");
  if (!workerRow) {
    const worker = await sb.from("workers").select("id,user_id,active").eq("user_id", profile.data.id).maybeSingle();
    databaseError(worker.error);
    workerRow = worker.data;
  }
  return { id: String(profile.data.id), workerCode: String(profile.data.worker_code ?? workerRow?.id), active: profile.data.active !== false && workerRow?.active !== false };
}

async function readSummary(sb: AdminClient, target: Target): Promise<WorkerModerationSummary> {
  const [state, access, blocks, events, cleanup] = await Promise.all([
    sb.from("worker_moderation").select("status,reason,suspended_at,deleted_at,purge_started_at").eq("user_id", target.id).maybeSingle(),
    sb.from("worker_access_ips").select("ip,last_seen_at").eq("user_id", target.id).order("last_seen_at", { ascending: false }).limit(100),
    sb.from("worker_ip_blocks").select("ip").eq("user_id", target.id),
    sb.from("worker_moderation_events").select("id,action,reason,created_at,actor_label").eq("user_id", target.id)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(25),
    sb.from("worker_deletion_jobs").select("status,next_attempt_at").eq("user_id", target.id).maybeSingle(),
  ]);
  for (const result of [state, access, blocks, events, cleanup]) databaseError(result.error);
  const blocked = new Set((blocks.data ?? []).map(row => String(row.ip)));
  return {
    status: (state.data?.status && state.data.status !== "active" ? state.data.status : target.active ? "active" : "suspended") as WorkerModerationStatus,
    reason: state.data?.reason ?? null,
    suspendedAt: state.data?.suspended_at ?? null,
    deletedAt: state.data?.deleted_at ?? null,
    purgeAfter: workerPurgeAfter(state.data?.deleted_at) ?? null,
    purgeStartedAt: state.data?.purge_started_at ?? null,
    cleanupStatus: ["scheduled", "processing", "retry"].includes(cleanup.data?.status) ? cleanup.data?.status as WorkerModerationSummary["cleanupStatus"] : null,
    cleanupRetryAt: cleanup.data?.status === "retry" ? cleanup.data.next_attempt_at : null,
    lastSeenAt: access.data?.[0]?.last_seen_at ?? null,
    knownIps: (access.data ?? []).map(row => ({ ip: String(row.ip), lastSeenAt: String(row.last_seen_at), blocked: blocked.has(String(row.ip)) })),
    history: (events.data ?? []).map(row => ({ id: String(row.id), action: row.action as WorkerModerationAction, reason: String(row.reason), createdAt: String(row.created_at), actorLabel: String(row.actor_label) })),
  };
}

export async function getWorkerModeration(workerId: string): Promise<WorkerModerationSummary> {
  const sb = supabaseAdmin();
  return readSummary(sb, await resolveTarget(sb, workerId));
}

function moderationError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  const known: Record<string, [number, string]> = {
    invalid_moderation_action: [400, "Choose a valid moderation action."],
    moderation_reason_required: [400, "Enter a reason between 8 and 1,000 characters."],
    moderation_confirmation_required: [400, "The confirmation must exactly match the worker ID."],
    worker_ip_not_observed: [409, "This IP has not been captured for this worker. Refresh and select an available address."],
    invalid_worker_ip: [400, "Select a captured public IP address."],
    actor_ip_required: [409, "IP blocking requires trusted IP capture for your current connection."],
    admin_ip_protected: [409, "This address is used by an administrator and cannot be blocked."],
    worker_purge_started: [409, "Permanent deletion has started. This account can no longer be restored."],
  };
  const match = error.code === "P0001" ? known[error.message ?? ""] : undefined;
  if (match) throw new ApiError(match[0], match[1], error.message);
  if (error.code === "PGRST202") throw new ApiError(503, "A required database update has not been applied yet.", "schema_outdated");
  databaseError(error);
}

export async function moderateWorker({ actorId, workerId, input, actorIp }: {
  actorId: string;
  workerId: string;
  input: unknown;
  actorIp: string | null;
}): Promise<WorkerModerationSummary> {
  const body = validateWorkerModerationInput(input);
  const sb = supabaseAdmin();
  const target = await resolveTarget(sb, workerId);
  if (target.id === actorId) throw new ApiError(403, "Administrators cannot moderate their own account.", "forbidden");
  if (body.action === "delete" && body.confirmation !== target.workerCode) throw new ApiError(400, "The confirmation must exactly match the worker ID.", "moderation_confirmation_required");
  const result = await sb.rpc("moderate_worker", {
    p_actor: actorId, p_worker: target.id, p_action: body.action, p_reason: body.reason,
    p_confirmation: body.confirmation ?? null, p_ip: body.ip ?? null, p_actor_ip: actorIp,
  });
  moderationError(result.error);
  // Re-read the active flags changed by the transaction before deriving status.
  return readSummary(sb, await resolveTarget(sb, workerId));
}
