import { withApi } from "@/lib/api/route";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

async function handleGET(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const name = (url.searchParams.get("name") || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });
  if (!path.startsWith("kyc/") || path.includes("..")) return NextResponse.json({ error: "Invalid file path" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from("kyc").download(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });
  }

  const buf = Buffer.from(await data.arrayBuffer());
  return new Response(buf, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

export const GET = withApi({ auth: "admin" }, handleGET);
