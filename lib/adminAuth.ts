import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function requireAdmin(req: Request) {
  try {
    const actor = await authenticate(req);
    if (!actor.isAdmin) return { ok: false as const, status: 403, reason: "Administrator access required." };
    return { ok: true as const, adminId: actor.user.id, sadmin: supabaseAdmin(), devBypass: false as boolean };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false as const, status: error.status, reason: error.message };
    throw error;
  }
}
