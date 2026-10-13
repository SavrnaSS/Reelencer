import { NextResponse } from "next/server";
import { authenticate } from "@/lib/api/auth";
import { NO_STORE_HEADERS } from "@/lib/api/gigApplications";
import { createSelfieSession } from "@/lib/api/kycSelfie";
import { withApi } from "@/lib/api/route";

// Starts a live-selfie capture: returns the challenge to show on screen and a short-lived token the upload needs.
export const POST = withApi({ auth: "user", rateLimit: 20 }, async (req) => {
  const actor = await authenticate(req);
  return NextResponse.json(createSelfieSession(actor.user.id), { headers: NO_STORE_HEADERS });
});
