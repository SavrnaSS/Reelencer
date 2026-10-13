import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ApiError, databaseError } from "./errors";

const buckets = new Map<string, { count: number; expires: number }>();
export function localRateLimit(key: string, limit: number, now = Date.now()) {
  if (buckets.size > 5000) {
    for (const [id, bucket] of buckets) if (bucket.expires <= now) buckets.delete(id);
    if (buckets.size > 5000) throw new ApiError(429, "Too many requests. Please wait a minute.", "rate_limited");
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.expires <= now) buckets.set(key, { count: 1, expires: now + 60_000 });
  else if (++bucket.count > limit) throw new ApiError(429, "Too many requests. Please wait a minute.", "rate_limited");
}

export async function mutationRateLimit(userId: string, route: string, limit = 40) {
  const key = createHash("sha256").update(`${userId}:${route}`).digest("hex");
  if (process.env.NODE_ENV !== "production") return localRateLimit(key, limit);
  const { data, error } = await supabaseAdmin().rpc("consume_api_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: 60 });
  databaseError(error);
  if (data !== true) throw new ApiError(429, "Too many requests. Please wait a minute.", "rate_limited");
}
