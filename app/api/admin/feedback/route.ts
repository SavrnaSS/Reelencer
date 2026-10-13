import { withApi } from "@/lib/api/route";
import {
  canUseDashboardFeedbackDevStore,
  listDashboardFeedbackDev,
  updateDashboardFeedbackDev,
} from "@/lib/dashboardFeedbackDevStore";
import type { DashboardFeedbackStatus } from "@/lib/dashboardFeedbackDevStore";
import { json, requireAdminFromBearer, supabaseAdmin } from "../_utils";

const FEEDBACK_STATUSES = new Set<DashboardFeedbackStatus>(["new", "reviewing", "resolved", "closed"]);

function tableMissing(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("relation") ||
    lower.includes("undefined table") ||
    lower.includes("schema cache") ||
    lower.includes("could not find the table")
  );
}

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeStatus(value: unknown): DashboardFeedbackStatus | null {
  const raw = text(value, 32).toLowerCase() as DashboardFeedbackStatus;
  return FEEDBACK_STATUSES.has(raw) ? raw : null;
}

async function handleGET(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  if (guard.devBypass) return json(200, { ok: true, feedbacks: [] });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("dashboard_feedback")
    .select(
      "id,user_id,worker_id,profile_name,profile_role,section,language_code,language_name,category,rating,subject,message,allow_contact,status,admin_note,source,page_url,meta,created_at,updated_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    if (tableMissing(error.message)) {
      if (canUseDashboardFeedbackDevStore()) {
        const feedbacks = await listDashboardFeedbackDev();
        return json(200, { ok: true, feedbacks });
      }
      return json(200, { ok: true, feedbacks: [], missingSchema: true });
    }
    return json(500, { ok: false, error: error.message });
  }

  return json(200, { ok: true, feedbacks: data ?? [] });
}

async function handlePATCH(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });
  if (guard.devBypass) return json(200, { ok: true, feedback: null });

  const body = await req.json().catch(() => ({}));
  const id = text(body?.id, 64);
  const status = normalizeStatus(body?.status);
  const adminNote = text(body?.adminNote, 2400) || null;

  if (!id) return json(400, { ok: false, error: "Feedback id is required." });
  if (!status) return json(400, { ok: false, error: "Valid feedback status is required." });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("dashboard_feedback")
    .update({
      status,
      admin_note: adminNote,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(
      "id,user_id,worker_id,profile_name,profile_role,section,language_code,language_name,category,rating,subject,message,allow_contact,status,admin_note,source,page_url,meta,created_at,updated_at"
    )
    .single();

  if (error) {
    if (tableMissing(error.message)) {
      if (canUseDashboardFeedbackDevStore()) {
        const feedback = await updateDashboardFeedbackDev(id, { status, admin_note: adminNote });
        if (!feedback) return json(404, { ok: false, error: "Feedback item not found." });
        return json(200, { ok: true, feedback });
      }
      return json(500, { ok: false, error: "Missing schema. Run scripts/dashboard-feedback-schema.sql first." });
    }
    return json(500, { ok: false, error: error.message });
  }

  return json(200, { ok: true, feedback: data });
}

export const GET = withApi({ auth: "admin" }, handleGET);

export const PATCH = withApi({ auth: "admin" }, handlePATCH);
