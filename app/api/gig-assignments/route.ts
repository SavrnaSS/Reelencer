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

async function resolveWorkerPayoutId(sb: ReturnType<typeof supabaseAdmin>, workerCode: string) {
  if (!workerCode.startsWith("WKR-")) return workerCode;
  const { data } = await sb.from("profiles").select("id").eq("worker_code", workerCode).maybeSingle();
  return data?.id ? String(data.id) : workerCode;
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
    .select("id,title,payout,payout_type")
    .eq("id", assignment.gig_id)
    .maybeSingle();

  if (gigError || !gig) {
    return gigError?.message || "Gig not found for approval sync";
  }

  const publicId = buildApprovalWorkItemId(assignmentId);
  const rewardInr = parsePayoutAmount((gig as any).payout);
  const title = `${String((gig as any).title ?? "Gig").trim() || "Gig"} credential pack`;
  const now = new Date().toISOString();
  const resolvedStatus =
    status === "Accepted"
      ? "Approved"
      : status === "Rejected"
        ? "Hard rejected"
        : "Needs fix";
  const completedAt = resolvedStatus === "Approved" || resolvedStatus === "Hard rejected" ? now : null;

  const existing = await sb.from("work_items").select("id").eq("public_id", publicId).maybeSingle();
  if (existing.data?.id) {
    let update = await sb
      .from("work_items")
      .update({
        title,
        worker_id: assignment.worker_code,
        account_id: assignment.id,
        status: resolvedStatus,
        reward_inr: rewardInr,
        completed_at: completedAt,
        due_at: now,
      })
      .eq("id", existing.data.id);
    if (update.error) {
      update = await sb
        .from("work_items")
        .update({
          title,
          worker_id: assignment.worker_code,
          accountId: assignment.id,
          status: resolvedStatus,
          rewardINR: rewardInr,
          completedAt,
          dueAt: now,
        })
        .eq("id", existing.data.id);
    }
    return update.error ? update.error.message : null;
  }

  if (status !== "Accepted") {
    return null;
  }

  let insert = await sb.from("work_items").insert({
    public_id: publicId,
    title,
    type: "Credential Submission",
    account_id: assignment.id,
    worker_id: assignment.worker_code,
    created_at: now,
    due_at: now,
    completed_at: now,
    status: "Approved",
    priority: "P2",
    reward_inr: rewardInr,
    est_minutes: 5,
    sla_minutes: 5,
    review: {
      source: "gig_assignment_approval",
      assignmentId,
      payoutType: (gig as any).payout_type ?? null,
      autoApprovedAt: now,
    },
  });
  if (insert.error) {
    insert = await sb.from("work_items").insert({
      public_id: publicId,
      title,
      type: "Credential Submission",
      accountId: assignment.id,
      worker_id: assignment.worker_code,
      createdAt: now,
      dueAt: now,
      completedAt: now,
      status: "Approved",
      priority: "P2",
      rewardINR: rewardInr,
      estMinutes: 5,
      slaMinutes: 5,
      review: {
        source: "gig_assignment_approval",
        assignmentId,
        payoutType: (gig as any).payout_type ?? null,
        autoApprovedAt: now,
      },
    });
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

  const workerPayoutId = await resolveWorkerPayoutId(sb, String(assignment.worker_code ?? ""));
  const { data: upiRow, error: upiError } = await sb
    .from("upi_configs")
    .select("upi_id,verified")
    .eq("worker_id", workerPayoutId)
    .maybeSingle();
  if (upiError) return { error: upiError.message };
  if (!upiRow?.verified) {
    return { error: "Worker payout method is not verified yet. Verify UPI before releasing funds." };
  }

  const publicId = buildApprovalWorkItemId(assignmentId);
  const { data: workItem, error: workItemError } = await sb
    .from("work_items")
    .select("id,title,reward_inr,rewardINR")
    .eq("public_id", publicId)
    .maybeSingle();
  if (workItemError || !workItem?.id) {
    return { error: workItemError?.message || "Approved earning item not found for release." };
  }

  const { data: existingPayoutItem, error: existingPayoutItemError } = await sb
    .from("payout_items")
    .select("id,status,batch_id")
    .eq("work_item_id", String(workItem.id))
    .neq("status", "Failed")
    .maybeSingle();
  if (existingPayoutItemError) return { error: existingPayoutItemError.message };

  if (existingPayoutItem?.id) {
    const { data: existingBatch } = await sb
      .from("payout_batches")
      .select("id,status,paid_at")
      .eq("id", String(existingPayoutItem.batch_id))
      .maybeSingle();
    return {
      ok: true,
      fundsReleased: String(existingPayoutItem.status ?? "") === "Paid",
      payoutBatchId: existingBatch?.id ? String(existingBatch.id) : String(existingPayoutItem.batch_id),
      payoutStatus: String(existingPayoutItem.status ?? existingBatch?.status ?? "Included"),
    };
  }

  const { data: gig } = await sb.from("gigs").select("id,title").eq("id", assignment.gig_id).maybeSingle();
  const amountInr = Number((workItem as any).reward_inr ?? (workItem as any).rewardINR ?? 0);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const cycleLabel = `Direct credential release ${today}`;

  const { data: batchRow, error: batchError } = await sb
    .from("payout_batches")
    .insert({
      worker_id: workerPayoutId,
      cycle_label: cycleLabel,
      period_start: today,
      period_end: today,
      status: "Paid",
      method: "UPI",
      processed_at: now,
      paid_at: now,
      notes: [`Direct release for assignment ${assignmentId}`, `UPI:${String(upiRow.upi_id ?? "")}`],
    })
    .select("id")
    .maybeSingle();
  if (batchError || !batchRow?.id) {
    return { error: batchError?.message || "Unable to create payout batch for direct release." };
  }

  const { error: payoutItemError } = await sb.from("payout_items").insert({
    batch_id: String(batchRow.id),
    work_item_id: String(workItem.id),
    worker_id: workerPayoutId,
    handle: String((gig as any)?.title ?? `gig:${assignment.gig_id}`),
    amount_inr: amountInr,
    status: "Paid",
  });
  if (payoutItemError) {
    return { error: payoutItemError.message };
  }

  return {
    ok: true,
    fundsReleased: true,
    payoutBatchId: String(batchRow.id),
    payoutStatus: "Paid",
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

  const payload = (data ?? []).map((row: any) => ({
    id: String(row.id),
    gigId: String(row.gig_id),
    workerId: String(row.worker_code),
    assignedEmail: row.assigned_email,
    assignedEmails: row.assigned_emails ?? undefined,
    status: row.status,
    submittedAt: row.submitted_at ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    createdAt: row.created_at,
  }));

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
        return NextResponse.json(
          {
            id: String(fallback.id),
            gigId: String(fallback.gig_id),
            workerId: String(fallback.worker_code),
            assignedEmail: fallback.assigned_email,
            assignedEmails,
            status: fallback.status,
            submittedAt: fallback.submitted_at ?? undefined,
            decidedAt: fallback.decided_at ?? undefined,
            createdAt: fallback.created_at,
          },
          { headers: NO_STORE_HEADERS }
        );
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
        return NextResponse.json(
          {
            id: String(fallback.id),
            gigId: String(fallback.gig_id),
            workerId: String(fallback.worker_code),
            assignedEmail: fallback.assigned_email,
            assignedEmails,
            status: fallback.status,
            submittedAt: fallback.submitted_at ?? undefined,
            decidedAt: fallback.decided_at ?? undefined,
            createdAt: fallback.created_at,
          },
          { headers: NO_STORE_HEADERS }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      {
        id: String(data.id),
        gigId: String(data.gig_id),
        workerId: String(data.worker_code),
        assignedEmail: data.assigned_email,
        assignedEmails: data.assigned_emails ?? assignedEmails,
        status: data.status,
        submittedAt: data.submitted_at ?? undefined,
        decidedAt: data.decided_at ?? undefined,
        createdAt: data.created_at,
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

    let fundRelease: { ok?: boolean; fundsReleased?: boolean; payoutBatchId?: string; payoutStatus?: string; error?: string } | null = null;
    if (nextStatus === "Accepted" && releaseFundsNow) {
      fundRelease = await releaseAssignmentFunds(sb, String(body.id));
      if (fundRelease?.error) {
        return NextResponse.json({ error: fundRelease.error }, { status: 400, headers: NO_STORE_HEADERS });
      }
    }

    return NextResponse.json(
      {
        id: String(data.id),
        gigId: String(data.gig_id),
        workerId: String(data.worker_code),
        assignedEmail: data.assigned_email,
        assignedEmails: (data as any).assigned_emails ?? undefined,
        status: data.status,
        submittedAt: data.submitted_at ?? undefined,
        decidedAt: data.decided_at ?? undefined,
        createdAt: data.created_at,
        fundsReleased: fundRelease?.fundsReleased ?? false,
        payoutBatchId: fundRelease?.payoutBatchId ?? undefined,
        payoutStatus: fundRelease?.payoutStatus ?? undefined,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid payload" }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
