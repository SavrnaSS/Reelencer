export async function supabaseBrowserFetch(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : "Network request failed";

    return new Response(
      JSON.stringify({
        message: `Supabase network request failed: ${detail}`,
        code: "supabase_network_error",
      }),
      {
        status: 520,
        statusText: "Supabase network unavailable",
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
