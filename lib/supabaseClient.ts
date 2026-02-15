// lib/supabaseClient.ts
import { createBrowserClient } from "@supabase/ssr";

function getBrowserSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) return { url, anonKey };

  // Avoid crashing during server prerender/build when envs are not injected.
  if (typeof window === "undefined") {
    return {
      url: "https://placeholder.supabase.co",
      anonKey: "placeholder-anon-key",
    };
  }

  throw new Error(
    "Missing Supabase public envs: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
  );
}

const { url, anonKey } = getBrowserSupabaseEnv();

export const supabase = createBrowserClient(url, anonKey);
