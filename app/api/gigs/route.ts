import { isValidViewPayoutRate } from "@/lib/socialAnalytics";
import { withApi } from "@/lib/api/route";
import { z } from "zod";

const gigInput = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  title: z.string().trim().min(1).max(200), company: z.string().trim().min(1).max(160),
  workload: z.string().trim().min(1).max(500), payout: z.string().trim().min(1).max(100),
  platform: z.string().max(80).optional(), location: z.string().max(200).optional(),
  payoutType: z.string().max(80).optional(), gigType: z.string().max(80).optional(),
  verified: z.boolean().optional(), requirements: z.array(z.string().max(12000)).max(80).optional(),
  status: z.enum(["Open", "Paused", "Closed"]).optional(), applicationMode: z.enum(["apply", "proposal"]).optional(),
});
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveGigApplicationMode } from "@/lib/gigApplicationMode";
import { reelKitRequirementsForGig } from "@/lib/reelKit";
import { ApiError } from "@/lib/api/errors";
import {
  createDevDashboardGig,
  deleteDevDashboardGig,
  getDevDashboardGigs,
  isDashboardDevMode,
  updateDevDashboardGig,
} from "@/lib/dashboardDevData";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeGigRow(g: Record<string, unknown>) {
  const requirements = reelKitRequirementsForGig(g.id, Array.isArray(g.requirements) ? g.requirements.filter((item): item is string => typeof item === "string") : []);
  const rawApplicationMode =
    typeof g.application_mode === "string"
      ? g.application_mode
      : typeof g.applicationMode === "string"
        ? g.applicationMode
        : null;
  const postedAt = typeof g.posted_at === "string" ? g.posted_at : null;
  return {
    id: String(g.id ?? ""),
    title: g.title,
    company: g.company,
    verified: Boolean(g.verified),
    platform: g.platform,
    location: g.location,
    workload: g.workload,
    payout: g.payout,
    payoutType: g.payout_type,
    gigType: g.gig_type ?? "Email Creator",
    requirements,
    applicationMode: resolveGigApplicationMode({
      requirements,
      applicationMode: rawApplicationMode,
    }),
    status: g.status,
    postedAt: postedAt ? new Date(postedAt).toLocaleDateString() : "Posted",
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function handleGET() {
  if (isDashboardDevMode()) {
    return NextResponse.json(getDevDashboardGigs().map(gig => ({ ...gig, requirements: reelKitRequirementsForGig(gig.id, gig.requirements) })), { headers: NO_STORE_HEADERS });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("gigs").select("*").order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
  const payload = (data ?? []).map((g) => normalizeGigRow((g ?? {}) as Record<string, unknown>));
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

function validateViewRate(payout: unknown, payoutType: unknown) {
  if (String(payoutType ?? "").trim().toLowerCase() === "per 1k views" && !isValidViewPayoutRate(String(payout ?? ""))) {
    throw new Error("Per 1k Views requires a positive amount per 1,000 views with at most two decimal places.");
  }
}

function validateReelKitScope(gigId: unknown, requirements?: string[]) {
  if (requirements && reelKitRequirementsForGig(gigId, requirements).length !== requirements.length) {
    throw new ApiError(400, "The demo wallet reel kit is only available for its original reaction-video gig.", "reel_kit_scope");
  }
}

async function handlePOST(req: Request) {
  try {
    const parsed = gigInput.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid gig fields." }, { status: 400 });
    const body = parsed.data;
    validateReelKitScope(body.id, body.requirements);
    validateViewRate(body.payout, body.payoutType);
    if (!body?.title || !body?.company || !body?.workload || !body?.payout) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (isDashboardDevMode()) {
      const created = createDevDashboardGig(body);
      return created.ok
        ? NextResponse.json(created.gig, { headers: NO_STORE_HEADERS })
        : NextResponse.json({ error: created.error }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("gigs")
      .insert({
        id: body.id,
        title: body.title,
        company: body.company,
        verified: body.verified ?? true,
        platform: body.platform,
        location: body.location,
        workload: body.workload,
        payout: body.payout,
        payout_type: body.payoutType,
        gig_type: body.gigType ?? "Email Creator",
        application_mode: body.applicationMode,
        requirements: Array.isArray(body.requirements) ? body.requirements : [],
        status: body.status ?? "Open",
        posted_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      normalizeGigRow(data as Record<string, unknown>),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    return NextResponse.json({ error: errorMessage(error, "Invalid payload") }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

async function handlePATCH(req: Request) {
  try {
    const body = await req.json();
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const parsed = gigInput.omit({ id: true }).partial().safeParse(body.updates);
    if (!parsed.success || !Object.keys(parsed.data).length) return NextResponse.json({ error: "Invalid gig updates." }, { status: 400 });
    const updates = parsed.data;
    validateReelKitScope(body.id, updates.requirements);
    if (isDashboardDevMode()) {
      const current = getDevDashboardGigs().find((gig) => gig.id === String(body.id));
      validateViewRate(updates.payout ?? current?.payout, updates.payoutType ?? current?.payoutType);
      const updated = updateDevDashboardGig(String(body.id), updates);
      return updated.ok
        ? NextResponse.json(updated.gig, { headers: NO_STORE_HEADERS })
        : NextResponse.json({ error: updated.error }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const sb = supabaseAdmin();
    if (updates.payout !== undefined || updates.payoutType !== undefined) {
      const { data: current, error: readError } = await sb.from("gigs").select("payout,payout_type").eq("id", body.id).maybeSingle();
      if (readError) throw new Error("Could not validate the payout rate.");
      if (!current) return NextResponse.json({ error: "Gig not found." }, { status: 404, headers: NO_STORE_HEADERS });
      validateViewRate(updates.payout ?? current.payout, updates.payoutType ?? current.payout_type);
    }
    const { data, error } = await sb
      .from("gigs")
      .update({
        title: updates.title,
        company: updates.company,
        verified: updates.verified,
        platform: updates.platform,
        location: updates.location,
        workload: updates.workload,
        payout: updates.payout,
        payout_type: updates.payoutType,
        gig_type: updates.gigType,
        application_mode: updates.applicationMode,
        requirements: Array.isArray(updates.requirements) ? updates.requirements : undefined,
        status: updates.status,
      })
      .eq("id", String(body.id))
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    if (!data) {
      return NextResponse.json({ error: "Gig not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json(
      normalizeGigRow(data as Record<string, unknown>),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    return NextResponse.json({ error: errorMessage(error, "Invalid payload") }, { status: 400, headers: NO_STORE_HEADERS });
  }
}

async function handleDELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (isDashboardDevMode()) {
    deleteDevDashboardGig(id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  }
  const sb = supabaseAdmin();
  const { error } = await sb.from("gigs").delete().eq("id", String(id));
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}

export const GET = withApi({ auth: "public" }, handleGET);

export const POST = withApi({ auth: "admin" }, handlePOST);

export const PATCH = withApi({ auth: "admin" }, handlePATCH);

export const DELETE = withApi({ auth: "admin" }, handleDELETE);
