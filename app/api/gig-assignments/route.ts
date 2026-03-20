import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function parsePayoutAmount(raw: unknown) {
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const normalized = text.replace(/[, ]+/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function buildApprovalWorkItemId(assignmentId: string) {
  const compact = String(assignmentId ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `GIGCRED-${compact.slice(0, 18) || "ITEM"}`;
}

function buildApprovalAccountId(assignmentId: string) {
  const compact = String(assignmentId ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `GIGACC-${compact.slice(0, 18) || "ITEM"}`;
}

const APPROVAL_WORK_ITEM_TYPE = "Reel posting";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissingColumn(msg?: string | null) {
  if (!msg) return false;
  return (
    (msg.includes("column") && msg.includes("does not exist")) ||
    (msg.includes("Could not find the") && msg.includes("column")) ||
    msg.includes("schema cache")
  );
}

function stripMissing(payload: Record<string, any>, msg?: string | null) {
  if (!msg) return payload;
  const match = msg.match(/column ['"]?([a-zA-Z0-9_]+)['"]?/);
  const col = match?.[1];
  if (!col) return payload;
  const next = { ...payload };
  delete next[col];
  return next;
}

async function resolveWorkerPayoutId(sb: ReturnType<typeof supabaseAdmin>, workerCode: string) {
  const normalized = String(workerCode ?? "").trim();
  if (!normalized) return null;
  if (isUuid(normalized)) return normalized;
  if (!normalized.startsWith("WKR-")) return null;
  const { data } = await sb.from("profiles").select("id").eq("worker_code", workerCode).maybeSingle();
  return data?.id ? String(data.id) : null;
}

async function ensureApprovalAccountId(
  sb: ReturnType<typeof supabaseAdmin>,
  assignmentId: string,
  gig: { title?: string | null; company?: string | null; platform?: string | null }
) {
  const accountId = buildApprovalAccountId(assignmentId);
  const existing = await sb.from("accounts").select("id").eq("id", accountId).maybeSingle();
  if (existing.data?.id) return accountId;
  if (existing.error && !isMissingColumn(existing.error.message)) {
    return existing.error.message;
  }

  const { data: firstCredential } = await sb
    .from("gig_account_credentials")
    .select("handle,email")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const rawHandle =
    String(firstCredential?.handle ?? "")
      .trim()
      .replace(/^@+/, "")
      .replace(/\s+/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "") ||
    String(firstCredential?.email ?? "")
      .split("@")[0]
      ?.trim()
      .replace(/[^a-zA-Z0-9._-]/g, "") ||
    accountId.toLowerCase();

  let payload: Record<string, any> = {
    id: accountId,
    handle: rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`,
    niche: String(gig.platform ?? "Credential Workflow").trim() || "Credential Workflow",
    owner_team: String(gig.company ?? "Gig Ops").trim() || "Gig Ops",
    policy_tier: "Standard",
    health: "Healthy",
    rules: [],
    allowed_audios: [],
    required_hashtags: [],
  };

  for (let i = 0; i < 6; i += 1) {
    const insert = await sb.from("accounts").insert(payload).select("id").maybeSingle();
    if (!insert.error) return accountId;
    if (!isMissingColumn(insert.error.message)) return insert.error.message;
    const stripped = stripMissing(payload, insert.error.message);
    if (Object.keys(stripped).length === Object.keys(payload).length) return insert.error.message;
    payload = stripped;
  }

  return "Unable to prepare synthetic account for credential payout.";
}

async function resolveAssignmentReleaseState(
  sb: ReturnType<typeof supabaseAdmin>,
  assignmentId: string,
  assignmentStatus: string
) {
  const { data, error } = await sb
    .from("work_items")
    .select("status,review")
    .eq("public_id", buildApprovalWorkItemId(assignmentId))
    .maybeSingle();

  if (error) {
    return {
      earningsReleaseStatus: assignmentStatus === "Rejected" ? "blocked" : assignmentStatus === "Accepted" ? "queued" : "none",
      earningsReleasedAt: undefined,
    };
  }

  const workStatus = String((data as any)?.status ?? "");
  const earningsReleasedAt = (data as any)?.review?.walletReleasedAt
    ? String((data as any).review.walletReleasedAt)
    : undefined;

  if (workStatus === "Approved") {
    return { earningsReleaseStatus: "credited", earningsReleasedAt };
  }
  if (assignmentStatus === "Rejected" || workStatus === "Hard rejected") {
    return { earningsReleaseStatus: "blocked", earningsReleasedAt };
  }
  if (assignmentStatus === "Accepted" || workStatus === "Submitted") {
    return { earningsReleaseStatus: "queued", earningsReleasedAt };
  }
  return { earningsReleaseStatus: "none", earningsReleasedAt };
}

async function mapAssignmentRow(sb: ReturnType<typeof supabaseAdmin>, row: any) {
  const releaseState = await resolveAssignmentReleaseState(sb, String(row.id), String(row.status ?? ""));
  return {
    id: String(row.id),
    gigId: String(row.gig_id),
    workerId: String(row.worker_code),
    assignedEmail: row.assigned_email,
    assignedEmails: row.assigned_emails ?? undefined,
    status: row.status,
    submittedAt: row.submitted_at ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    createdAt: row.created_at,
    earningsReleaseStatus: releaseState.earningsReleaseStatus,
    earningsReleasedAt: releaseState.earningsReleasedAt,
  };
}

async function syncApprovalEarnings(sb: ReturnType<typeof supabaseAdmin>, assignmentId: string, status: string) {
  const { data: assignment, error: assignmentError } = await sb
    .from("gig_assignments")
    .select("id,gig_id,worker_code")
    .eq("id", assignmentId)
    .maybeSingle();

  if (assignmentError || !assignment) {
    return assignmentError?.message || "Assignment not found for approval sync";
  }

  const { data: gig, error: gigError } = await sb
    .from("gigs")
    .select("id,title,company,platform,payout,payout_type")
    .eq("id", assignment.gig_id)
    .maybeSingle();

  if (gigError || !gig) {
    return gigError?.message || "Gig not found for approval sync";
  }

  const workerLedgerId = await resolveWorkerPayoutId(sb, String(assignment.worker_code ?? ""));
  if (!workerLedgerId) {
    return "Worker profile could not be resolved for approval sync.";
  }
  const approvalAccountId = await ensureApprovalAccountId(sb, assignmentId, gig as any);
  if (!approvalAccountId || approvalAccountId.startsWith("Unable") || approvalAccountId.includes(" ")) {
    return approvalAccountId || "Synthetic approval account could not be prepared.";
  }

  const publicId = buildApprovalWorkItemId(assignmentId);
  const rewardInr = parsePayoutAmount((gig as any).payout);
  const title = `${String((gig as any).title ?? "Gig").trim() || "Gig"} credential pack`;
  const now = new Date().toISOString();
  const existing = await sb.from("work_items").select("id,status,review").eq("public_id", publicId).maybeSingle();
  const currentStatus = String((existing.data as any)?.status ?? "");
  const resolvedStatus =
    status === "Accepted"
      ? currentStatus === "Approved"
        ? "Approved"
        : "Submitted"
      : status === "Rejected"
        ? "Hard rejected"
        : "Submitted";
  const completedAt = resolvedStatus === "Approved" || resolvedStatus === "Hard rejected" ? now : null;
  const baseWorkItemPayload = {
    title,
    worker_id: workerLedgerId,
    status: resolvedStatus,
    reward_inr: rewardInr,
    completed_at: completedAt,
    due_at: now,
  };
  const createWorkItemPayload = {
    public_id: publicId,
    title,
    type: APPROVAL_WORK_ITEM_TYPE,
    worker_id: workerLedgerId,
    created_at: now,
    due_at: now,
    completed_at: completedAt,
    status: resolvedStatus,
    priority: "P2",
    reward_inr: rewardInr,
    est_minutes: 5,
    sla_minutes: 5,
    review: {
      source: "gig_assignment_approval",
      assignmentId,
      workerCode: assignment.worker_code,
      payoutType: (gig as any).payout_type ?? null,
      autoAcceptedAt: now,
      walletReleasedAt:
        resolvedStatus === "Approved"
          ? (existing.data as any)?.review?.walletReleasedAt ?? now
          : (existing.data as any)?.review?.walletReleasedAt ?? null,
    },
  };

  if (existing.data?.id) {
    let update = await sb
      .from("work_items")
      .update({
        ...baseWorkItemPayload,
        account_id: approvalAccountId,
      })
      .eq("id", existing.data.id);
    if (update.error && isMissingColumn(update.error.message)) {
      update = await sb.from("work_items").update(baseWorkItemPayload).eq("id", existing.data.id);
    }
    return update.error ? update.error.message : null;
  }

  if (status !== "Accepted") {
    return null;
  }

  let insert = await sb.from("work_items").insert({
    ...createWorkItemPayload,
    account_id: approvalAccountId,
  });
  if (insert.error && isMissingColumn(insert.error.message)) {
    insert = await sb.from("work_items").insert(createWorkItemPayload);
  }

  return insert.error ? insert.error.message : null;
}

async function releaseAssignmentFunds(sb: ReturnType<typeof supabaseAdmin>, assignmentId: string) {
  const { data: assignment, error: assignmentError } = await sb
    .from("gig_assignments")
    .select("id,gig_id,worker_code,status")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignmentError || !assignment) {
    return { error: assignmentError?.message || "Assignment not found for fund release" };
  }
  if (String(assignment.status ?? "") !== "Accepted") {
    return { error: "Funds can only be released after admin approval." };
  }

  const publicId = buildApprovalWorkItemId(assignmentId);
  const { data: workItem, error: workItemError } = await sb
    .from("work_items")
    .select("id,title,reward_inr,status,review")
    .eq("public_id", publicId)
    .maybeSingle();
  if (workItemError || !workItem?.id) {
    return { error: workItemError?.message || "Approved earning item not found for wallet credit." };
  }

  if (String((workItem as any).status ?? "") === "Approved") {
    return {
      ok: true,
      fundsReleased: true,
      payoutStatus: "Credited",
    };
  }

  const now = new Date().toISOString();
  const nextReview = {
    ...((workItem as any).review ?? {}),
    walletReleasedAt: now,
    walletReleaseSource: "admin_assignment_action",
  };
  const { error: releaseError } = await sb
    .from("work_items")
    .update({
      status: "Approved",
      completed_at: now,
      review: nextReview,
    })
    .eq("id", String(workItem.id));
  if (releaseError) return { error: releaseError.message };

  return {
    ok: true,
    fundsReleased: true,
    payoutStatus: "Credited",
  };
}

function makeEmail(gigId: string, workerId: string) {
  const short = `${gigId}-${workerId}`.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toLowerCase();
  return `gig-${short}-${Math.random().toString(36).slice(2, 6)}@fasterdrop.site`;
}

function makeEmails(gigId: string, workerId: string, count: number, seed?: string) {
  const emails: string[] = [];
  if (seed) emails.push(seed);
  while (emails.length < count) {
    const next = makeEmail(gigId, workerId);
    if (!emails.includes(next)) emails.push(next);
  }
  return emails;
}

function normalizeEmails(value: any) {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      // ignore
    }
  }
  return [];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gigId = url.searchParams.get("gigId") ?? undefined;
  const workerId = url.searchParams.get("workerId") ?? undefined;
  const all = url.searchParams.get("all") === "1";

  const sb = supabaseAdmin();
  let query = sb.from("gig_assignments").select("*").order("created_at", { ascending: false });
  if (!all) {
    if (gigId) query = query.eq("gig_id", gigId);
    if (workerId) query = query.eq("worker_code", workerId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }

  const payload = await Promise.all((data ?? []).map((row: any) => mapAssignmentRow(sb, row)));

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.gigId || !body?.workerId) {
      return NextResponse.json({ error: "gigId and workerId required" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const sb = supabaseAdmin();
    let existing: any = null;
    const { data: existingWithFilter, error: existingError } = await sb
      .from("gig_assignments")
      .select("id, assigned_email, assigned_emails, status, created_at, submitted_at, decided_at, subject_filter")
      .eq("gig_id", body.gigId)
      .eq("worker_code", body.workerId)
      .maybeSingle();
    if (!existingError) {
      existing = existingWithFilter;
    } else if (String(existingError.message || "").toLowerCase().includes("assigned_emails")) {
      const { data: existingFallback } = await sb
        .from("gig_assignments")
        .select("id, assigned_email, status, created_at, submitted_at, decided_at, subject_filter")
        .eq("gig_id", body.gigId)
        .eq("worker_code", body.workerId)
        .maybeSingle();
      existing = existingFallback;
    } else if (String(existingError.message || "").toLowerCase().includes("subject_filter")) {
      const { data: existingFallback } = await sb
        .from("gig_assignments")
        .select("id, assigned_email, status, created_at, submitted_at, decided_at")
        .eq("gig_id", body.gigId)
        .eq("worker_code", body.workerId)
        .maybeSingle();
      existing = existingFallback;
    }

    const assignedEmail = body.assignedEmail ?? existing?.assigned_email ?? makeEmail(body.gigId, body.workerId);
    const existingList = normalizeEmails(existing?.assigned_emails);
    const assignedEmails =
      body.assignedEmails ??
      (existingList.length > 0 ? existingList : makeEmails(body.gigId, body.workerId, 5, assignedEmail));

    const { data, error } = await sb
      .from("gig_assignments")
      .upsert(
        {
          gig_id: body.gigId,
          worker_code: body.workerId,
          assigned_email: assignedEmail,
          assigned_emails: assignedEmails,
          status: body.status ?? existing?.status ?? "Assigned",
          created_at: existing?.created_at ?? new Date().toISOString(),
          submitted_at: existing?.submitted_at ?? null,
          decided_at: existing?.decided_at ?? null,
          subject_filter: body.subjectFilter ?? existing?.subject_filter ?? null,
        },
        { onConflict: "gig_id,worker_code" }
      )
      .select("*")
      .single();

    if (error) {
      const message = String(error.message || "");
      if (message.toLowerCase().includes("assigned_emails")) {
        const { data: fallback, error: fallbackError } = await sb
          .from("gig_assignments")
          .upsert(
            {
              gig_id: body.gigId,
              worker_code: body.workerId,
              assigned_email: assignedEmail,
              status: body.status ?? existing?.status ?? "Assigned",
              created_at: existing?.created_at ?? new Date().toISOString(),
              submitted_at: existing?.submitted_at ?? null,
              decided_at: existing?.decided_at ?? null,
              subject_filter: body.subjectFilter ?? existing?.subject_filter ?? null,
            },
            { onConflict: "gig_id,worker_code" }
          )
          .select("*")
          .single();
        if (fallbackError) {
          return NextResponse.json({ error: fallbackError.message }, { status: 500, headers: NO_STORE_HEADERS });
        }
        return NextResponse.json(await mapAssignmentRow(sb, { ...fallback, assigned_emails: assignedEmails }), {
          headers: NO_STORE_HEADERS,
        });
      }
      if (message.toLowerCase().includes("subject_filter")) {
        const { data: fallback, error: fallbackError } = await sb
          .from("gig_assignments")
          .upsert(
            {
              gig_id: body.gigId,
              worker_code: body.workerId,
              assigned_email: assignedEmail,
              status: body.status ?? existing?.status ?? "Assigned",
              created_at: existing?.created_at ?? new Date().toISOString(),
              submitted_at: existing?.submitted_at ?? null,
              decided_at: existing?.decided_at ?? null,
            },
            { onConflict: "gig_id,worker_code" }
          )
          .select("*")
          .single();
        if (fallbackError) {
          return NextResponse.json({ error: fallbackError.message }, { status: 500, headers: NO_STORE_HEADERS });
        }
        return NextResponse.json(await mapAssignmentRow(sb, { ...fallback, assigned_emails: assignedEmails }), {
          headers: NO_STORE_HEADERS,
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      {
        ...(await mapAssignmentRow(sb, { ...data, assigned_emails: data.assigned_emails ?? assignedEmails })),
        subjectFilter: data.subject_filter ?? undefined,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const updates = body.updates ?? {};
    const sb = supabaseAdmin();
    const nextStatus = String(updates.status ?? "");
    const releaseFundsNow = !!updates.releaseFundsNow;
    const { data, error } = await sb
      .from("gig_assignments")
      .update({
        status: nextStatus,
        submitted_at: updates.submittedAt,
        decided_at: updates.decidedAt,
      })
      .eq("id", String(body.id))
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    if (nextStatus === "Accepted" || nextStatus === "Rejected" || nextStatus === "Pending") {
      const syncError = await syncApprovalEarnings(sb, String(body.id), nextStatus);
      if (syncError) {
        return NextResponse.json({ error: syncError }, { status: 500, headers: NO_STORE_HEADERS });
      }
    }

    let fundRelease: { ok?: boolean; fundsReleased?: boolean; payoutStatus?: string; error?: string } | null = null;
    if (nextStatus === "Accepted" && releaseFundsNow) {
      fundRelease = await releaseAssignmentFunds(sb, String(body.id));
      if (fundRelease?.error) {
        return NextResponse.json({ error: fundRelease.error }, { status: 400, headers: NO_STORE_HEADERS });
      }
    }
    const releaseState = await resolveAssignmentReleaseState(sb, String(data.id), String(data.status ?? ""));

    return NextResponse.json(
      {
        ...(await mapAssignmentRow(sb, data)),
        fundsReleased: fundRelease?.fundsReleased ?? false,
        payoutStatus: fundRelease?.payoutStatus ?? undefined,
        earningsReleaseStatus: releaseState.earningsReleaseStatus,
        earningsReleasedAt: releaseState.earningsReleasedAt,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
