import { NextResponse, type NextRequest } from "next/server";
import { withApi } from "@/lib/api/route";
import { limitAuthMail, normalizeEmail, remindExistingAccount, withMailErrors } from "@/lib/api/authEmails";

// Re-sends the confirmation link for an unconfirmed account. Same response for every address.
async function handlePOST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  await limitAuthMail(email, "/api/auth/resend");
  await withMailErrors(() => remindExistingAccount(req, email));
  return NextResponse.json({ ok: true, status: "sent" });
}

export const POST = withApi({ auth: "public", maxBytes: 2 * 1024 }, handlePOST);
