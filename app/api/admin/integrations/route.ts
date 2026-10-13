import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { NO_STORE_HEADERS } from "@/lib/api/gigApplications";
import { saveSyncSettings, syncIntegrationStatus, testSyncProvider } from "@/lib/api/integrations";
import { withApi } from "@/lib/api/route";

// Auto-sync credentials from the admin console. Values go in, only status and hints come out.

export const GET = withApi({ auth: "admin" }, async () => NextResponse.json(await syncIntegrationStatus(), { headers: NO_STORE_HEADERS }));

const value = z.string().max(4000).nullable().optional();
const values = z.object({ youtubeApiKey: value, metaAccessToken: value, anthropicApiKey: value, metaIgBusinessId: z.string().max(40).regex(/^\d*$/, "The business account id is numeric.").nullable().optional() });
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), values }),
  z.object({ action: z.literal("test"), provider: z.enum(["youtube", "instagram", "vision"]), values: values.extend({ instagramHandle: z.string().max(30).optional() }).optional() }),
]);

export const POST = withApi({ auth: "admin", rateLimit: 30 }, async (req) => {
  const actor = await authenticate(req);
  const parsed = actions.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid request.", "invalid_input");
  const body = parsed.data;
  if (body.action === "test") {
    const candidate = Object.fromEntries(Object.entries(body.values ?? {}).filter(([, v]) => typeof v === "string" && v.trim())) as Record<string, string>;
    return NextResponse.json(await testSyncProvider(body.provider, candidate), { headers: NO_STORE_HEADERS });
  }
  await saveSyncSettings(actor.user.id, body.values);
  return NextResponse.json(await syncIntegrationStatus(), { headers: NO_STORE_HEADERS });
});
