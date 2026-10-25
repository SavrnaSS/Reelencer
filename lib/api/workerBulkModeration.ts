import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { BulkAction, BulkApplyRequest, BulkPreview, BulkPreviewItem, BulkResult } from "@/lib/workerBulkTypes";
import { ApiError, databaseError } from "./errors";
import { isUuid } from "./work";

type PlanItem = BulkPreviewItem & { expectedUpdatedAt: string | null; expectedProfileActive: boolean; expectedWorkerActive: boolean | null };
type SignedPlan = { version: 1; actorId: string; action: BulkAction; expiresAt: string; items: PlanItem[] };
const actions = new Set<BulkAction>(["suspend", "suspend_ip", "restore", "delete"]);
const validId = /^[a-zA-Z0-9_-]{1,80}$/;

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "A valid bulk request is required.", "invalid_bulk_request");
  return input as Record<string, unknown>;
}

function previewKey() {
  const secret = process.env.WORK_EMAIL_CRYPTO_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (secret.length < 32) throw new ApiError(503, "Bulk previews are temporarily unavailable.", "bulk_signing_unavailable");
  return createHmac("sha256", secret).update("reelencer:worker-bulk-preview:v1").digest();
}

function signPlan(plan: SignedPlan) {
  const payload = Buffer.from(JSON.stringify(plan)).toString("base64url");
  return `${payload}.${createHmac("sha256", previewKey()).update(payload).digest("base64url")}`;
}

function readPlan(value: unknown, actorId: string): SignedPlan {
  if (typeof value !== "string" || value.length > 320 * 1024) throw new ApiError(400, "Create a fresh preview before applying a bulk action.", "invalid_bulk_preview");
  const parts = value.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw new ApiError(400, "This preview is invalid. Create a fresh preview.", "invalid_bulk_preview");
  const signature = createHmac("sha256", previewKey()).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], "base64url");
  if (supplied.length !== signature.length || !timingSafeEqual(signature, supplied)) throw new ApiError(400, "This preview is invalid. Create a fresh preview.", "invalid_bulk_preview");
  let plan: SignedPlan;
  try { plan = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { throw new ApiError(400, "This preview is invalid. Create a fresh preview.", "invalid_bulk_preview"); }
  if (plan.version !== 1 || plan.actorId !== actorId || !actions.has(plan.action) || !Number.isFinite(Date.parse(plan.expiresAt)) || !Array.isArray(plan.items) || plan.items.length < 1 || plan.items.length > 100) {
    throw new ApiError(400, "This preview does not belong to this administrator. Create a fresh preview.", "invalid_bulk_preview");
  }
  // Expiry is checked under the database operation lock, after replay recovery.
  return plan;
}

function bulkError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  const messages: Record<string, [number, string]> = {
    bulk_idempotency_conflict: [409, "This operation ID already belongs to a different request. Recover its result before starting another operation."],
    bulk_preview_expired: [409, "This preview expired before the operation was applied. Create a fresh preview."],
    invalid_bulk_selection: [400, "Select between 1 and 100 valid users."],
    invalid_bulk_operation: [400, "A valid operation ID is required."],
    invalid_moderation_action: [400, "Choose a valid bulk action."],
    moderation_reason_required: [400, "Enter a reason between 8 and 1,000 characters."],
  };
  const known = error.code === "P0001" ? messages[error.message ?? ""] : undefined;
  if (known) throw new ApiError(known[0], known[1], error.message);
  if (error.code === "PGRST202") throw new ApiError(503, "A required database update has not been applied yet.", "schema_outdated");
  databaseError(error);
}

export async function previewWorkerBulk(actorId: string, input: unknown, actorIp: string | null): Promise<BulkPreview> {
  const body = object(input);
  if (typeof body.action !== "string" || !actions.has(body.action as BulkAction)) throw new ApiError(400, "Choose a valid bulk action.", "invalid_moderation_action");
  if (!Array.isArray(body.workerIds) || body.workerIds.length < 1 || body.workerIds.length > 100 || body.workerIds.some(value => typeof value !== "string" || !validId.test(value))) {
    throw new ApiError(400, "Select between 1 and 100 valid users.", "invalid_bulk_selection");
  }
  const action = body.action as BulkAction;
  const result = await supabaseAdmin().rpc("preview_workers_bulk", { p_actor: actorId, p_worker_ids: [...new Set(body.workerIds)], p_action: action, p_actor_ip: actorIp });
  bulkError(result.error);
  if (!Array.isArray(result.data) || result.data.length < 1 || result.data.length > 100) throw new ApiError(503, "The user preview is unavailable. Please retry.", "invalid_bulk_response");
  const plan: SignedPlan = {
    version: 1, actorId, action, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    items: result.data.map(item => ({ ...item, expectedUpdatedAt: item.expectedUpdatedAt ?? null, expectedWorkerActive: item.expectedWorkerActive ?? null })) as PlanItem[],
  };
  const eligibleCount = plan.items.filter(item => item.eligible).length;
  return {
    token: signPlan(plan), expiresAt: plan.expiresAt, action,
    items: plan.items.map(item => ({ workerId: item.workerId, userId: item.userId, name: item.name, email: item.email, status: item.status,
      eligible: item.eligible, ...(item.skipReason ? { skipReason: item.skipReason } : {}), ...(item.ip ? { ip: item.ip } : {}) })),
    eligibleCount, skippedCount: plan.items.length - eligibleCount, canBlockIps: !!actorIp,
  };
}

export async function applyWorkerBulk(actorId: string, input: unknown, actorIp: string | null): Promise<BulkResult> {
  const body = object(input);
  if (typeof body.operationId !== "string" || !isUuid(body.operationId)) throw new ApiError(400, "A valid operation ID is required.", "invalid_bulk_operation");
  const plan = readPlan(body.previewToken, actorId);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 8 || reason.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) throw new ApiError(400, "Enter a reason between 8 and 1,000 characters.", "moderation_reason_required");
  const eligibleCount = plan.items.filter(item => item.eligible).length;
  const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : undefined;
  if (plan.action === "delete" && confirmation !== `DELETE ${eligibleCount} USERS`) throw new ApiError(400, `Type DELETE ${eligibleCount} USERS to confirm.`, "bulk_confirmation_required");
  if (plan.action === "suspend_ip" && body.sharedNetworkConfirmed !== true) throw new ApiError(400, "Acknowledge that shared IP addresses can affect other users.", "bulk_network_confirmation_required");
  const request: BulkApplyRequest = { previewToken: body.previewToken as string, operationId: body.operationId, reason,
    ...(confirmation ? { confirmation } : {}), ...(body.sharedNetworkConfirmed === true ? { sharedNetworkConfirmed: true } : {}) };
  const requestHash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
  const result = await supabaseAdmin().rpc("moderate_workers_bulk", {
    p_actor: actorId, p_action: plan.action, p_reason: reason, p_items: plan.items,
    p_operation_id: body.operationId, p_request_hash: requestHash, p_preview_expires_at: plan.expiresAt, p_actor_ip: actorIp,
  });
  bulkError(result.error);
  if (!result.data || typeof result.data !== "object" || !Array.isArray(result.data.items)) throw new ApiError(503, "The operation result could not be read. Recover it using the same operation ID.", "bulk_result_unavailable");
  return result.data as BulkResult;
}

export async function getWorkerBulkResult(actorId: string, operationId: string): Promise<BulkResult> {
  if (!isUuid(operationId)) throw new ApiError(400, "A valid operation ID is required.", "invalid_bulk_operation");
  const result = await supabaseAdmin().from("worker_bulk_operations").select("result").eq("id", operationId).eq("actor_id", actorId).maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ApiError(404, "No completed result is available yet. Retry the same request with the same operation ID.", "bulk_result_not_found");
  return result.data.result as BulkResult;
}
