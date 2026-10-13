import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerFetch } from "@/lib/supabase/serverFetch";

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server database configuration is missing.");
  return createClient(url, key, {
    db: { timeout: 15_000, retry: false },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: supabaseServerFetch },
  });
}
