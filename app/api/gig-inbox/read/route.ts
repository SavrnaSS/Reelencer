import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const assignmentId = String(body?.assignmentId ?? "");
    const messageIds = Array.isArray(body?.messageIds) ? body.messageIds.map(String) : [];
    const readAt = body?.readAt ?? new Date().toISOString();

    if (!assignmentId || messageIds.length === 0) {
      return NextResponse.json(
        { error: "assignmentId and messageIds required" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const sb = supabaseAdmin();
    const { error } = await sb
      .from("gig_inbox")
      .update({ read_at: readAt })
      .eq("assignment_id", assignmentId)
      .in("id", messageIds);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
