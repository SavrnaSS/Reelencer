import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function requireAdmin(req: NextRequest) {
  const sadmin = supabaseAdmin();

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";

  if (!token) return { ok: false as const, reason: "Missing token" };

  const { data: u, error: uErr } = await sadmin.auth.getUser(token);
  const user = u?.user;
  if (uErr || !user) return { ok: false as const, reason: "Invalid token" };

  const prof = await sadmin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof.error) return { ok: false as const, reason: prof.error.message };
  const role = String(prof.data?.role ?? "").toLowerCase();
  if (role !== "admin") return { ok: false as const, reason: "Not admin" };

  return { ok: true as const, adminId: user.id, sadmin };
}
