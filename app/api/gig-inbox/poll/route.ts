import { withApi } from "@/lib/api/route";
import { NextResponse } from "next/server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

async function handlePOST() {
  return NextResponse.json(
    { error: "IMAP polling disabled. Use /api/gig-inbox/ingest via Cloudflare Email Routing." },
    { status: 410, headers: NO_STORE_HEADERS }
  );
}

export const POST = withApi({ auth: "public" }, handlePOST);
