import { withApi } from "@/lib/api/route";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getRoleForUser } from "@/lib/auth";

function sanitizeReadState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => typeof k === "string" && k.trim() && typeof v === "string")
      .map(([k, v]) => [String(k), String(v)])
  );
}

async function getAuthedUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Missing Authorization" }, { status: 401 }) };
  }

  const token = authHeader.slice("Bearer ".length);
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return { error: NextResponse.json({ error: "Invalid token" }, { status: 401 }) };
  }

  const role = await getRoleForUser(data.user.id);
  if (!role) {
    return { error: NextResponse.json({ error: "No profile role found" }, { status: 403 }) };
  }

  return { admin, user: data.user };
}

async function handleGET(req: Request) {
  const auth = await getAuthedUser(req);
  if ("error" in auth) return auth.error;

  const stored = (auth.user.user_metadata)?.workspaceNotificationState;
  const readState = sanitizeReadState(stored?.readState);

  return NextResponse.json({
    readState,
    updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : null,
  });
}

async function handlePATCH(req: Request) {
  const auth = await getAuthedUser(req);
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const readState = sanitizeReadState(body?.readState);
  const nextUserMetadata = {
    ...(auth.user.user_metadata ?? {}),
    workspaceNotificationState: {
      readState,
      updatedAt: new Date().toISOString(),
    },
  };

  const { data, error } = await auth.admin.auth.admin.updateUserById(auth.user.id, {
    user_metadata: nextUserMetadata,
  });

  if (error) {
    return NextResponse.json({ error: error.message || "Unable to save notification state" }, { status: 500 });
  }

  const stored = (data.user.user_metadata)?.workspaceNotificationState;
  return NextResponse.json({
    ok: true,
    readState: sanitizeReadState(stored?.readState),
    updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : null,
  });
}

export const GET = withApi({ auth: "user" }, handleGET);

export const PATCH = withApi({ auth: "user" }, handlePATCH);
