// lib/supabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowserFetch } from "./supabase/browserFetch";

type BrowserSupabaseClient = SupabaseClient;

const globalForSupabase = globalThis as typeof globalThis & {
  __reelencerSupabaseClient?: BrowserSupabaseClient;
};

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

export function createSupabaseBrowser() {
  if (typeof window !== "undefined" && globalForSupabase.__reelencerSupabaseClient) {
    return globalForSupabase.__reelencerSupabaseClient;
  }

  const { url, anonKey } = getBrowserSupabaseEnv();
  const client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: typeof window !== "undefined",
      flowType: "pkce",
      persistSession: true,
    },
    global: {
      fetch: supabaseBrowserFetch,
    },
  });

  if (typeof window !== "undefined") {
    globalForSupabase.__reelencerSupabaseClient = client;
  }

  return client;
}

export const supabase = createSupabaseBrowser();
