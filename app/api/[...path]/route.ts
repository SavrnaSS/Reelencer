import { NextResponse } from "next/server";

// Unknown API paths answer 404 for every method. Without this, a POST to a missing route rendered the not-found
// page with status 200, so a scheduler calling a mistyped or not-yet-deployed job URL saw "success".
// Every real route under app/api is more specific and always wins over this catch-all.
const notFound = () => NextResponse.json({ ok: false, error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = () => new NextResponse(null, { status: 404 });
export const OPTIONS = notFound;
