import { NextResponse, type NextRequest } from "next/server";
import { withApi } from "@/lib/api/route";
import { limitAuthMail, normalizeEmail, sendPasswordReset, withMailErrors } from "@/lib/api/authEmails";

// Emails a password-reset link through the app's mailer. Same response for every address.
async function handlePOST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  await limitAuthMail(email, "/api/auth/password-reset");
  await withMailErrors(() => sendPasswordReset(req, email));
  return NextResponse.json({ ok: true, status: "sent" });
}

export const POST = withApi({ auth: "public", maxBytes: 2 * 1024 }, handlePOST);
