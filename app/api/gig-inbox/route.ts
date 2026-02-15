import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

// ✅ default: last 2 hours (you can override with ?hours=6 etc.)
const DEFAULT_HOURS = 2;

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
        assignedEmails = (assignment as any).assigned_emails.map((e: any) => String(e).toLowerCase());
      } else if ((assignment as any).assigned_email) {
        assignedEmails = [String((assignment as any).assigned_email).toLowerCase()];
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

  const payload = (data ?? []).map((row: any) => ({
    id: String(row.id),
    assignmentId: String(row.assignment_id),
    toEmail: row.to_email,
    subject: row.subject,
    body: row.body,
    otpCode: row.otp_code,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
  }));

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

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
