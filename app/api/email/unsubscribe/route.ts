import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyUnsubscribe } from "@/lib/email/unsubscribe";

// One-click unsubscribe from Reelencer's promotional email (gig promotions and announcements). Service notices, such
// as Terms reminders or payout updates, still arrive. Not wrapped in withApi: mail apps POST here cross-site with a
// form body (RFC 8058 List-Unsubscribe-Post), and the signed link is the authorisation.

const esc = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

function page(title: string, body: string, action?: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Reelencer</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f6f3;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a201c;padding:16px}
main{max-width:420px;width:100%;background:#fff;border:1px solid #e3e5e1;border-radius:18px;padding:28px;box-shadow:0 1px 2px rgba(26,32,28,.05)}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 18px;color:#4b544e;font-size:14.5px}
button,a.btn{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 18px;border-radius:12px;border:0;background:#1f2b24;color:#fff;font:600 14.5px/1 inherit;text-decoration:none;cursor:pointer;width:100%}
.brand{font-weight:700;color:#2e7d4f;font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px}</style></head>
<body><main><div class="brand">Reelencer</div><h1>${esc(title)}</h1><p>${body}</p>${action ?? `<a class="btn" href="/">Go to Reelencer</a>`}</main></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

const invalid = () => page("This link doesn't work", "The unsubscribe link is incomplete or has expired. Use the link from your most recent Reelencer email, or reply to it and we'll take you off the list.", undefined, 400);

// GET only asks: link scanners open links, and must not unsubscribe anyone.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = verifyUnsubscribe(url.searchParams.get("e"), url.searchParams.get("t"));
  if (!email) return invalid();
  const action = `<form method="post" action="${esc(url.pathname + url.search)}"><button type="submit">Unsubscribe</button></form>`;
  return page("Unsubscribe from promotions?", `<strong>${esc(email)}</strong> will stop getting gig promotions and announcements. You'll still get important notices about your account, applications and payouts.`, action);
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const email = verifyUnsubscribe(url.searchParams.get("e"), url.searchParams.get("t"));
  if (!email) return invalid();
  const { error } = await supabaseAdmin().from("email_unsubscribes").upsert({ email }, { onConflict: "email", ignoreDuplicates: true });
  if (error) return page("Something went wrong", "We couldn't save your choice. Please try again in a moment.", undefined, 503);
  return page("You're unsubscribed", `<strong>${esc(email)}</strong> won't get gig promotions or announcements any more. Important notices about your account still arrive.`);
}
