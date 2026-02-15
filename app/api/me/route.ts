import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getRoleForUser, getWorkerIdForUser } from "@/lib/auth";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");

  // If you’re not sending Authorization header, we can still keep it simple:
  // In production upgrade to @supabase/ssr. For now, accept a client-provided access token.
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing Authorization. (Upgrade to SSR auth next.)" }, { status: 401 });
  }

  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const userId = data.user.id;
  const role = await getRoleForUser(userId);

  if (!role) return NextResponse.json({ error: "No profile role found" }, { status: 403 });

  const workerId = role === "worker" ? await getWorkerIdForUser(userId) : null;

  return NextResponse.json({ role, workerId });
}
