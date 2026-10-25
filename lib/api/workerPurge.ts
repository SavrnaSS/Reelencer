import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { databaseError } from "./errors";

type Sb = ReturnType<typeof supabaseAdmin>;
type Job = { id: string; user_id: string; lease_token: string; purge_after: string; requested_at: string };
type StoredFile = { bucket_id: string; name: string; version: string | null; versioned: boolean };
type Failure = "storage_failed" | "storage_versioning" | "auth_failed" | "cleanup_failed";
class PurgeError extends Error {
  constructor(public code: Failure) { super(code); }
}

async function purgeAccount(sb: Sb, job: Job, deadline: number): Promise<"completed" | "retrying"> {
  let removed = 0;
  let previousBatch = "";
  let failure: Failure = "cleanup_failed";
  try {
    while (true) {
      const result = await sb.rpc("worker_deletion_storage_batch", { p_job: job.id, p_token: job.lease_token, p_limit: 100 });
      databaseError(result.error);
      const files = (result.data ?? []) as StoredFile[];
      if (!Array.isArray(files)) throw new PurgeError("storage_failed");
      if (!files.length) break;
      if (Date.now() + 8000 >= deadline) {
        const yielded = await sb.rpc("retry_worker_deletion", { p_job: job.id, p_token: job.lease_token, p_error: "", p_removed: removed, p_yield: true });
        databaseError(yielded.error);
        return "retrying";
      }
      const batch = JSON.stringify(files);
      if (batch === previousBatch) throw new PurgeError("storage_failed");
      previousBatch = batch;
      failure = "storage_failed";
      const byBucket = new Map<string, StoredFile[]>();
      for (const file of files) {
        if (!file.bucket_id || !file.name || file.name.includes("\0")) throw new PurgeError("storage_failed");
        if (file.versioned && !file.version) throw new PurgeError("storage_versioning");
        const bucket = byBucket.get(file.bucket_id) ?? [];
        bucket.push(file);
        byBucket.set(file.bucket_id, bucket);
      }
      // Use Storage's API, including archived object versions. SQL-only deletion leaves the bytes behind.
      for (const [bucket, entries] of byBucket) {
        const result = await sb.storage.from(bucket).remove(entries.map(file => file.versioned ? { path: file.name, versionId: file.version! } : file.name));
        if (result.error) throw new PurgeError("storage_failed");
        removed += entries.length;
      }
    }
    // SQL verifies the lease, seven-day deadline and absence of owned objects again before allowing Auth erasure.
    failure = "cleanup_failed";
    const prepared = await sb.rpc("prepare_worker_auth_deletion", { p_job: job.id, p_token: job.lease_token, p_removed: removed });
    databaseError(prepared.error);
    if (prepared.data !== job.user_id) throw new PurgeError("cleanup_failed");
    removed = 0; // Already recorded by preparation; avoid counting it twice after an Auth retry.
    failure = "auth_failed";
    const result = await sb.auth.admin.deleteUser(job.user_id, false);
    if (result.error) throw new PurgeError("auth_failed");
    // The Auth transaction's trigger erases the database records and anonymizes the completed job atomically.
    const saved = await sb.from("worker_deletion_jobs").select("status").eq("id", job.id).maybeSingle();
    databaseError(saved.error);
    if (saved.data?.status !== "completed") throw new PurgeError("cleanup_failed");
    return "completed";
  } catch (error) {
    // A lost Auth response may follow a committed deletion. Recover it instead of reporting a false failure.
    const saved = await sb.from("worker_deletion_jobs").select("status").eq("id", job.id).maybeSingle();
    if (!saved.error && saved.data?.status === "completed") return "completed";
    const result = await sb.rpc("retry_worker_deletion", {
      p_job: job.id, p_token: job.lease_token, p_error: error instanceof PurgeError ? error.code : failure,
      p_removed: removed, p_yield: false,
    });
    databaseError(result.error);
    return "retrying";
  }
}

/** Small durable batches, run independently of admin visits. No force or early-deletion override exists. */
export async function purgeDeletedWorkers(sb: Sb = supabaseAdmin(), budgetMs = 25_000) {
  const started = Date.now();
  const initial = await sb.from("worker_purge_scheduler_state").upsert({ id: true, last_started_at: new Date(started).toISOString() });
  databaseError(initial.error);
  let processed = 0, completed = 0, retrying = 0;
  while (processed < 3 && (processed === 0 || Date.now() + 12_000 < started + budgetMs)) {
    const result = await sb.rpc("claim_worker_deletions", { p_limit: 1 });
    databaseError(result.error);
    const jobs = (result.data ?? []) as Job[];
    if (!Array.isArray(jobs)) throw new PurgeError("cleanup_failed");
    if (!jobs.length) break;
    for (const job of jobs) {
      if (!job.id || !job.user_id || !job.lease_token) throw new PurgeError("cleanup_failed");
      const status = await purgeAccount(sb, job, started + budgetMs);
      processed++;
      if (status === "completed") completed++; else retrying++;
    }
  }
  const finished = await sb.from("worker_purge_scheduler_state").upsert({ id: true, last_finished_at: new Date().toISOString(), processed, completed, retrying });
  databaseError(finished.error);
  return { processed, completed, retrying, durationMs: Date.now() - started };
}

export async function workerPurgeHealth(sb: Sb = supabaseAdmin()) {
  const [pending, due, retrying, heartbeat] = await Promise.all([
    sb.from("worker_deletion_jobs").select("id", { count: "exact", head: true }).neq("status", "completed"),
    sb.from("worker_deletion_jobs").select("id", { count: "exact", head: true }).neq("status", "completed").lte("purge_after", new Date().toISOString()),
    sb.from("worker_deletion_jobs").select("id", { count: "exact", head: true }).eq("status", "retry"),
    sb.from("worker_purge_scheduler_state").select("last_finished_at").eq("id", true).maybeSingle(),
  ]);
  for (const result of [pending, due, retrying, heartbeat]) databaseError(result.error);
  const lastRunAt = heartbeat.data?.last_finished_at as string | undefined;
  return { scheduled: pending.count ?? 0, due: due.count ?? 0, retrying: retrying.count ?? 0,
    scheduler: { healthy: !!lastRunAt && Date.now() - Date.parse(lastRunAt) < 3 * 60_000, lastRunAt: lastRunAt ?? null } };
}
