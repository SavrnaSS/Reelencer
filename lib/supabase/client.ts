// lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) {
    return createBrowserClient(url, anonKey);
  }

  if (typeof window === "undefined") {
    return createBrowserClient("https://placeholder.supabase.co", "placeholder-anon-key");
  }

  throw new Error(
    "Missing Supabase public envs: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
  );
}
