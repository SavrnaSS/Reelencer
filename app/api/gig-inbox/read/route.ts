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

    try {
      const { data: assignment } = await sb
        .from("gig_assignments")
        .select("assigned_emails, assigned_email")
        .eq("id", assignmentId)
        .maybeSingle();

      const assignedEmails = assignment
        ? Array.from(
            new Set(
              (
                Array.isArray((assignment as any).assigned_emails) && (assignment as any).assigned_emails.length > 0
                  ? (assignment as any).assigned_emails
                  : (assignment as any).assigned_email
                    ? [String((assignment as any).assigned_email)]
                    : []
              )
                .map((email: any) => String(email).trim().toLowerCase())
                .filter(Boolean)
            )
          )
        : [];

      if (assignedEmails.length > 0) {
        const { data: accounts, error: accountErr } = await sb
          .from("work_email_accounts")
          .select("id")
          .in("email", assignedEmails)
          .neq("status", "deleted");

        if (!accountErr && accounts && accounts.length > 0) {
          const accountIds = accounts.map((row: any) => String(row.id)).filter(Boolean);
          await sb
            .from("work_email_inbox")
            .update({ read_at: readAt })
            .in("account_id", accountIds)
            .in("id", messageIds);
        }
      }
    } catch {
      // ignore optional work-email read sync failures
    }

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
