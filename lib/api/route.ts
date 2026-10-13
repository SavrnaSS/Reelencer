import "server-only";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticate, shareAuthentication, assertWorkerAccess, requireAssignment } from "./auth";
import { ApiError } from "./errors";
import { localRateLimit, mutationRateLimit } from "./rateLimit";

type Options = { auth?: "user" | "admin" | "public" | "service"; maxBytes?: number; rateLimit?: number; assignment?: boolean };
type RouteContext = { params: Promise<Record<string, string>> };

async function boundedRequest(req: NextRequest, max: number) {
  if (!req.body) return req;
  if (Number(req.headers.get("content-length")) > max) throw new ApiError(413, "Request is too large.", "payload_too_large");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel();
      throw new ApiError(413, "Request is too large.", "payload_too_large");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  if (size && req.headers.get("content-type")?.includes("application/json")) {
    try {
      const value = JSON.parse(bytes.toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    } catch { throw new ApiError(400, "A valid JSON object is required.", "invalid_json"); }
  } else if (size && !req.headers.get("content-type")?.startsWith("multipart/form-data;")) {
    throw new ApiError(415, "Use application/json or multipart/form-data.", "unsupported_media_type");
  }
  return new NextRequest(req.url, { method: req.method, headers: req.headers, body: size ? bytes : undefined, signal: req.signal });
}

export function withApi<C = RouteContext>(options: Options, handler: (req: NextRequest, context: C) => Promise<Response | undefined>) {
  return async (incoming: NextRequest, context: C): Promise<Response> => {
    const requestId = randomUUID();
    const started = Date.now();
    let response: Response;
    try {
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(incoming.method);
      if (mutating) {
        const origin = incoming.headers.get("origin");
        const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
        const expected = configured ? new URL(configured).origin : new URL(incoming.url).origin;
        if (origin && origin !== expected && origin !== new URL(incoming.url).origin) throw new ApiError(403, "Cross-origin requests are not allowed.", "forbidden_origin");
        if (incoming.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "Cross-site requests are not allowed.", "forbidden_origin");
      }
      // A process-wide ceiling also bounds invalid-token traffic without trusting forwarded IP headers.
      localRateLimit("api-ceiling", 6000);
      if (options.auth === "service") {
        const supplied = /^Bearer (\S+)$/.exec(incoming.headers.get("authorization") ?? "")?.[1];
        if (!supplied) throw new ApiError(401, "Service authentication required.", "unauthorized");
        const secret = process.env.CRON_SECRET;
        if (!secret || secret.length < 32) throw new ApiError(503, "Service is not configured.");
        if (!timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(secret).digest())) throw new ApiError(401, "Invalid service token.", "unauthorized");
      } else if (options.auth !== "public") {
        const actor = await authenticate(incoming);
        if (options.auth === "admin" && !actor.isAdmin) throw new ApiError(403, "Administrator access required.", "forbidden");
        if (mutating) await mutationRateLimit(actor.user.id, new URL(incoming.url).pathname, options.rateLimit);
        else localRateLimit(`read:${actor.user.id}`, 600);
      }
      const req = mutating ? await boundedRequest(incoming, options.maxBytes ?? 256 * 1024) : incoming;
      shareAuthentication(incoming, req);
      if (options.auth !== "public" && options.auth !== "service") {
        const actor = await authenticate(req);
        const query = new URL(req.url).searchParams;
        const body = req.headers.get("content-type")?.includes("application/json") && req.body ? await req.clone().json() : {};
        if (!actor.isAdmin) {
          for (const id of [query.get("workerId"), body.workerId, body.userId, body.workerUserId]) {
            if (id) assertWorkerAccess(actor, id);
          }
          if (query.get("all") === "1") throw new ApiError(403, "Administrator access required.", "forbidden");
        }
        if (options.assignment) await requireAssignment(req, String(query.get("assignmentId") ?? body.assignmentId ?? ""));
      }
      response = await handler(req, context) ?? NextResponse.json({ error: "Service unavailable." }, { status: 503 });
      if (response.status >= 500) {
        // Existing routes sometimes return raw database errors. Never expose those to clients.
        console.error(JSON.stringify({ event: "api_error", requestId, method: req.method, path: new URL(req.url).pathname, status: response.status }));
        response = NextResponse.json({ ok: false, error: "The service is temporarily unavailable. Please try again.", code: "service_unavailable", requestId }, { status: response.status });
      }
    } catch (error) {
      const known = error instanceof ApiError;
      const status = known ? error.status : error instanceof SyntaxError ? 400 : 500;
      if (status >= 500) console.error(JSON.stringify({ event: "api_error", requestId, path: new URL(incoming.url).pathname, status, type: error instanceof Error ? error.name : "UnknownError" }));
      response = NextResponse.json({ ok: false, error: known ? error.message : status === 400 ? "Invalid request body." : "The service is temporarily unavailable. Please try again.", code: known ? error.code : "request_failed", requestId }, { status });
      if (status === 429) response.headers.set("Retry-After", "60");
    }
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Request-Id", requestId);
    response.headers.set("X-Content-Type-Options", "nosniff");
    if (process.env.API_REQUEST_LOGS === "true") console.info(JSON.stringify({ event: "api_request", requestId, method: incoming.method, path: new URL(incoming.url).pathname, status: response.status, durationMs: Date.now() - started }));
    return response;
  };
}
