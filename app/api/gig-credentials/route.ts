import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const assignmentId = url.searchParams.get("assignmentId");
  if (!assignmentId) {
    return NextResponse.json({ error: "assignmentId required" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("gig_account_credentials")
    .select("*")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
  const payload = (data ?? []).map((row: any) => ({
    id: String(row.id),
    assignmentId: String(row.assignment_id),
    handle: row.handle,
    password: row.password,
    email: row.email,
    phone: row.phone ?? undefined,
  }));
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.assignmentId || !Array.isArray(body?.accounts)) {
      return NextResponse.json({ error: "assignmentId and accounts required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (body.accounts.length !== 5) {
      return NextResponse.json({ error: "Exactly 5 accounts required" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const sb = supabaseAdmin();
    const { data: assignmentWithList, error: assignErr } = await sb
      .from("gig_assignments")
      .select("id, assigned_email, assigned_emails")
      .eq("id", body.assignmentId)
      .single();
    let assignment: any = assignmentWithList;
    if (assignErr && String(assignErr.message || "").toLowerCase().includes("assigned_emails")) {
      const { data: assignmentFallback, error: fallbackErr } = await sb
        .from("gig_assignments")
        .select("id, assigned_email")
        .eq("id", body.assignmentId)
        .single();
      if (fallbackErr) {
        return NextResponse.json({ error: "Assignment not found" }, { status: 404, headers: NO_STORE_HEADERS });
      }
      assignment = assignmentFallback;
    }
    if (assignErr || !assignment) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    await sb.from("gig_account_credentials").delete().eq("assignment_id", body.assignmentId);

    const rows = body.accounts.map((acc: any) => ({
      assignment_id: body.assignmentId,
      handle: String(acc.handle ?? ""),
      password: String(acc.password ?? ""),
      email: String(acc.email ?? ""),
      phone: acc.phone ? String(acc.phone) : null,
      created_at: new Date().toISOString(),
    }));

    const invalid = rows.some((row: any) => !row.handle || !row.password || !row.email);
    if (invalid) {
      return NextResponse.json({ error: "Each account requires handle, email, and password" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const assignedList = Array.isArray(assignment.assigned_emails)
      ? assignment.assigned_emails.map((e: any) => String(e).toLowerCase())
      : assignment.assigned_email
      ? [String(assignment.assigned_email).toLowerCase()]
      : [];

    if (assignedList.length > 0) {
      const submitted = rows.map((r: any) => String(r.email).toLowerCase());
      const allMatch = submitted.every((email: string) => assignedList.includes(email));
      const unique = new Set(submitted).size === submitted.length;
      if (!allMatch || !unique) {
        return NextResponse.json(
          { error: "Submitted emails must match the assigned emails (each used once)." },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }
    }

    const { error } = await sb.from("gig_account_credentials").insert(rows);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    await sb
      .from("gig_assignments")
      .update({ status: "Submitted", submitted_at: new Date().toISOString() })
      .eq("id", body.assignmentId);

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
