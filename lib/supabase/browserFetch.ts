export async function supabaseBrowserFetch(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : "Network request failed";

    return new Response(
      JSON.stringify({
        // Neutral wording: this can surface in the UI. The code is what callers match on.
        message: `Network request failed: ${detail}`,
        code: "supabase_network_error",
      }),
      {
        status: 520,
        statusText: "Network unavailable",
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
