import "server-only";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { GET as gigs } from "@/app/api/gigs/route";
import { GET as applications } from "@/app/api/gig-applications/route";
import { GET as assignments } from "@/app/api/gig-assignments/route";
import { GET as payoutBatches } from "@/app/api/payoutbatches/route";
import { shareAuthentication, type Actor } from "./auth";

type Reader = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const readers: Record<string, { path: string; read: Reader }> = {
  gigs: { path: "/api/gigs", read: gigs },
  applications: { path: "/api/gig-applications", read: applications },
  assignments: { path: "/api/gig-assignments", read: assignments },
  payoutBatches: { path: "/api/payoutbatches", read: payoutBatches },
};

/** Reuse the existing authorized read models in parallel, with one verified actor for the whole request. */
export async function creatorDashboardResponse(request: NextRequest, actor: Actor, sources = readers) {
  const workerId = actor.workerCode ?? actor.user.id;
  const results = await Promise.all(Object.entries(sources).map(async ([key, source]) => {
    try {
      const url = new URL(source.path, request.url);
      if (key !== "gigs") url.searchParams.set("workerId", workerId);
      const child = new NextRequest(url, { headers: request.headers, signal: request.signal });
      shareAuthentication(request, child);
      const response = await source.read(child, { params: Promise.resolve({}) });
      const data: unknown = await response.json();
      if (!response.ok || !Array.isArray(data)) throw new Error("Read unavailable");
      return { key, data };
    } catch { return { key, data: undefined }; }
  }));
  const data = Object.fromEntries(results.filter(result => result.data !== undefined).map(result => [result.key, result.data]));
  const errors = results.filter(result => result.data === undefined).map(result => result.key);
  if (errors.length === results.length) return NextResponse.json({ error: "Dashboard updates are temporarily unavailable." }, { status: 503 });
  const payload = { userId: actor.user.id, workerId, data, errors };
  const etag = `W/"${createHash("sha256").update(JSON.stringify(payload)).digest("base64url")}"`;
  const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie", ...(errors.length ? {} : { ETag: etag }) };
  if (!errors.length && request.headers.get("if-none-match")?.split(",").some(value => value.trim() === etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json(payload, { headers });
}
