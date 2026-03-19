import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

// Default to a longer window so verification emails remain visible across a normal work session.
const DEFAULT_HOURS = 24;

function uniqueLower(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value).trim().toLowerCase()).filter(Boolean)));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const assignmentId = url.searchParams.get("assignmentId");

  if (!assignmentId) {
    return NextResponse.json(
      { error: "assignmentId required" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const hoursParam = url.searchParams.get("hours");
  const hours = Math.max(1, Math.min(48, Number(hoursParam || DEFAULT_HOURS)));
  const cutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const sb = supabaseAdmin();

  // Optional safety filter: only return rows sent to assigned_emails (if column exists)
  let assignedEmails: string[] = [];
  try {
    const { data: assignment, error: assignErr } = await sb
      .from("gig_assignments")
      .select("assigned_emails, assigned_email")
      .eq("id", assignmentId)
      .single();
    if (!assignErr && assignment) {
      if (Array.isArray((assignment as any).assigned_emails)) {
        assignedEmails = uniqueLower((assignment as any).assigned_emails.map((e: any) => String(e)));
      } else if ((assignment as any).assigned_email) {
        assignedEmails = uniqueLower([String((assignment as any).assigned_email)]);
      }
    }
  } catch {
    // ignore safety filter failures
  }
  let query = sb
    .from("gig_inbox")
    .select("*")
    .eq("assignment_id", assignmentId)
    .gte("created_at", cutoffIso) // ✅ last X hours only
    .order("created_at", { ascending: false });

  if (assignedEmails.length > 0) {
    query = query.in("to_email", assignedEmails);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  const gigInboxRows = (data ?? []).map((row: any) => ({
    id: String(row.id),
    assignmentId: String(row.assignment_id),
    toEmail: row.to_email,
    subject: row.subject,
    body: row.body,
    otpCode: row.otp_code,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
    source: "gig",
  }));

  let workInboxRows: any[] = [];
  if (assignedEmails.length > 0) {
    try {
      const { data: accounts, error: accountsError } = await sb
        .from("work_email_accounts")
        .select("id, email, status")
        .in("email", assignedEmails)
        .neq("status", "deleted");

      if (accountsError) {
        const msg = String(accountsError.message || "").toLowerCase();
        const missingSchema = msg.includes("relation") || msg.includes("does not exist") || msg.includes("undefined table");
        if (!missingSchema) {
          return NextResponse.json(
            { error: accountsError.message },
            { status: 500, headers: NO_STORE_HEADERS }
          );
        }
      } else {
        const accountIds = (accounts ?? []).map((row: any) => String(row.id)).filter(Boolean);
        if (accountIds.length > 0) {
          const { data: workInbox, error: workInboxError } = await sb
            .from("work_email_inbox")
            .select("id, account_id, to_email, subject, body, otp_code, created_at, read_at")
            .in("account_id", accountIds)
            .gte("created_at", cutoffIso)
            .order("created_at", { ascending: false });

          if (workInboxError) {
            const msg = String(workInboxError.message || "").toLowerCase();
            const missingSchema = msg.includes("relation") || msg.includes("does not exist") || msg.includes("undefined table");
            if (!missingSchema) {
              return NextResponse.json(
                { error: workInboxError.message },
                { status: 500, headers: NO_STORE_HEADERS }
              );
            }
          } else {
            workInboxRows = (workInbox ?? []).map((row: any) => ({
              id: String(row.id),
              assignmentId,
              accountId: String(row.account_id),
              toEmail: row.to_email,
              subject: row.subject,
              body: row.body,
              otpCode: row.otp_code,
              createdAt: row.created_at,
              readAt: row.read_at ?? undefined,
              source: "work",
            }));
          }
        }
      }
    } catch {
      // ignore optional work-email fallback failures
    }
  }

  const payload = [...gigInboxRows, ...workInboxRows].sort(
    (a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime()
  );

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const assignmentId = url.searchParams.get("assignmentId");

  if (!assignmentId) {
    return NextResponse.json(
      { error: "assignmentId required" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("gig_inbox").delete().eq("assignment_id", assignmentId);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const { data: assignment } = await sb
      .from("gig_assignments")
      .select("assigned_emails, assigned_email")
      .eq("id", assignmentId)
      .maybeSingle();

    const assignedEmails = assignment
      ? uniqueLower(
          Array.isArray((assignment as any).assigned_emails) && (assignment as any).assigned_emails.length > 0
            ? (assignment as any).assigned_emails
            : (assignment as any).assigned_email
              ? [String((assignment as any).assigned_email)]
              : []
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
        await sb.from("work_email_inbox").delete().in("account_id", accountIds);
      }
    }
  } catch {
    // ignore optional work-email cleanup failures
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
