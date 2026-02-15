import { NextResponse } from "next/server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function POST() {
  return NextResponse.json(
    { error: "IMAP polling disabled. Use /api/gig-inbox/ingest via Cloudflare Email Routing." },
    { status: 410, headers: NO_STORE_HEADERS }
  );
}
