import { NextResponse } from "next/server";
import { isAdminRole } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) {
      return NextResponse.json({ error: "Missing access token" }, { status: 401 });
    }

    // Verify user from JWT (safe)
    const { data: userRes, error: userErr } = await supabaseAdmin().auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: userErr?.message || "Invalid session" }, { status: 401 });
    }

    const user = userRes.user;

    // Ensure profile exists
    const { data: existing, error: readErr } = await supabaseAdmin()
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }

    if (!existing) {
      // Create default profile row (Worker by default)
      const sb = supabaseAdmin();
      const { error: insErr } = await sb.from("profiles").insert({
        id: user.id,
        role: "Worker",
        display_name: user.user_metadata?.name || user.email,
      });

      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // Read role again
    const { data: prof, error: profErr } = await supabaseAdmin()
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

    const redirectTo = isAdminRole(prof.role) ? "/admin" : "/";

    return NextResponse.json({
      ok: true,
      role: prof.role,
      redirectTo,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
