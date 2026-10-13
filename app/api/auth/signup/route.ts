import { NextResponse, type NextRequest } from "next/server";
import { withApi } from "@/lib/api/route";
import { limitAuthMail, normalizeEmail, startSignup, withMailErrors } from "@/lib/api/authEmails";

// Creates the account and emails the confirmation link through the app's own mailer.
// The response is identical whether or not the address was already registered, so it can't be used to probe accounts.
async function handlePOST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim().slice(0, 100);
  await limitAuthMail(email, "/api/auth/signup");
  await withMailErrors(() => startSignup(req, { email, password, name }));
  return NextResponse.json({ ok: true, status: "sent" });
}

export const POST = withApi({ auth: "public", maxBytes: 4 * 1024 }, handlePOST);
