import { withApi } from "@/lib/api/route";
import { NextResponse } from "next/server";
import { getRoleForUser, getWorkerIdForUser } from "@/lib/auth";
import { canUseDashboardFeedbackDevStore, insertDashboardFeedbackDev } from "@/lib/dashboardFeedbackDevStore";
import type { DashboardFeedbackStatus } from "@/lib/dashboardFeedbackDevStore";
import { buildFeedbackSubject, FEEDBACK_MIN_MESSAGE_LENGTH, normalizeFeedbackCategory } from "@/lib/feedback";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

function normalizeRating(value: unknown) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  return rating;
}

function sanitizeMeta(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, string | number | boolean | null> = {};

  if (typeof source.viewportWidth === "number" && Number.isFinite(source.viewportWidth)) {
    out.viewportWidth = Math.round(source.viewportWidth);
  }
  if (typeof source.viewportHeight === "number" && Number.isFinite(source.viewportHeight)) {
    out.viewportHeight = Math.round(source.viewportHeight);
  }
  if (typeof source.deviceClass === "string") {
    out.deviceClass = text(source.deviceClass, 24);
  }
  if (typeof source.path === "string") {
    out.path = text(source.path, 240);
  }
  if (typeof source.userAgent === "string") {
    out.userAgent = text(source.userAgent, 220);
  }

  return out;
}

async function resolveAuthContext(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: null, role: null as string | null, workerId: null as string | null };
  }

  const token = authHeader.slice("Bearer ".length);
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return { userId: null, role: null as string | null, workerId: null as string | null };
  }

  const role = await getRoleForUser(data.user.id);
  const workerId = await getWorkerIdForUser(data.user.id);
  return { userId: data.user.id, role, workerId };
}

async function handlePOST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const auth = await resolveAuthContext(req);

    const message = text(body?.message, 2400);
    if (message.length < FEEDBACK_MIN_MESSAGE_LENGTH) {
      return NextResponse.json(
        { ok: false, error: `Feedback message must be at least ${FEEDBACK_MIN_MESSAGE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const category = normalizeFeedbackCategory(body?.category);
    const rating = normalizeRating(body?.rating);
    const section = text(body?.section, 64) || "Dashboard";
    const subject = text(body?.subject, 120) || buildFeedbackSubject({ section, category, rating });
    const languageCode = text(body?.languageCode, 16) || "en";
    const languageName = text(body?.languageName, 64) || null;
    const profileName = text(body?.profileName, 120) || null;
    const fallbackRole = text(body?.profileRole, 40) || null;
    const workerId = auth.workerId || null;
    const pageUrl = text(body?.pageUrl, 500) || null;
    const source = text(body?.source, 32) || "dashboard";
    const allowContact = body?.allowContact !== false;
    const profileRole =
      auth.role === "admin" ? "Admin" : auth.role === "worker" ? "Creator" : fallbackRole;

    const payload = {
      user_id: auth.userId,
      worker_id: workerId,
      profile_name: profileName,
      profile_role: profileRole,
      section,
      language_code: languageCode,
      language_name: languageName,
      category,
      rating,
      subject,
      message,
      allow_contact: allowContact,
      status: DEFAULT_FEEDBACK_STATUS,
      source,
      page_url: pageUrl,
      meta: sanitizeMeta(body?.meta),
      updated_at: new Date().toISOString(),
    };

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("dashboard_feedback")
      .insert(payload)
      .select("id,status,created_at")
      .single();

    if (error) {
      if (tableMissing(error.message)) {
        if (canUseDashboardFeedbackDevStore()) {
          const fallback = await insertDashboardFeedbackDev(payload);
          return NextResponse.json({
            ok: true,
            feedback: {
              id: fallback.id,
              status: fallback.status,
              created_at: fallback.created_at,
            },
          });
        }
        return NextResponse.json(
          { ok: false, missingSchema: true, error: "Missing schema. Run scripts/dashboard-feedback-schema.sql first." },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, feedback: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to submit feedback.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
const DEFAULT_FEEDBACK_STATUS: DashboardFeedbackStatus = "new";

export const POST = withApi({ auth: "user" }, handlePOST);
