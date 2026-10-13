function configuredSupabaseHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function supabaseNetworkErrorMessage(error: unknown) {
  const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : null;
  const causeRecord = cause && typeof cause === "object" ? (cause as { code?: unknown; hostname?: unknown }) : null;
  const code = text(causeRecord?.code);
  const hostname = text(causeRecord?.hostname) || configuredSupabaseHost();
  if (code === "ENOTFOUND") {
    return hostname ? `Supabase host could not be resolved: ${hostname}` : "Supabase host could not be resolved";
  }

  const message = error instanceof Error ? error.message : text((error as { message?: unknown } | null)?.message) || "Network request failed";
  const lower = message.toLowerCase();
  if (lower.includes("fetch failed") || lower.includes("load failed") || lower.includes("network")) {
    return hostname ? `Supabase host could not be reached: ${hostname}` : "Supabase host could not be reached";
  }
  return message;
}

export async function supabaseServerFetch(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const timeout = AbortSignal.timeout(15_000);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return await fetch(input, { ...init, cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (error) {
    const message = supabaseNetworkErrorMessage(error);
    return new Response(
      JSON.stringify({
        message,
        error: message,
        code: "supabase_network_error",
      }),
      {
        status: 503,
        statusText: "Supabase network unavailable",
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
