"use client";
import { supabase } from "@/lib/supabaseClient";

/** Attach the current Supabase token only to this application's API. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
    if (typeof init?.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (!headers.has("authorization")) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
    }
    return fetch(input, { ...init, headers, cache: "no-store" });
  }
  return fetch(input, init);
}
