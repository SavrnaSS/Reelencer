import { NextResponse } from "next/server";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { NO_STORE_HEADERS } from "@/lib/api/gigApplications";
import { MAX_SCREENSHOTS, MAX_SCREENSHOT_BYTES, applyReading, readScreenshots, sniffImage } from "@/lib/api/insightVision";
import { withApi } from "@/lib/api/route";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Upload insight screenshots of a linked account; the AI screenshot reader turns them into a check-in and reel
// numbers. Creators save straight away for their own accounts; admins can also `mode=preview` to fill a form first.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withApi({ auth: "user", maxBytes: MAX_SCREENSHOTS * MAX_SCREENSHOT_BYTES + 64 * 1024, rateLimit: 8 }, async (req) => {
  const actor = await authenticate(req);
  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "Upload the screenshots as a form.", "invalid_input");
  const accountId = String(form.get("accountId") ?? "");
  const postId = String(form.get("postId") ?? "") || undefined;
  const preview = form.get("mode") === "preview";
  if (!UUID.test(accountId) || (postId && !UUID.test(postId))) throw new ApiError(400, "Choose the account the screenshots belong to.", "invalid_input");
  if (preview && !actor.isAdmin) throw new ApiError(403, "Access denied.");

  const files = form.getAll("screenshots").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!files.length) throw new ApiError(400, "Add at least one screenshot.", "invalid_input");
  if (files.length > MAX_SCREENSHOTS) throw new ApiError(400, `Upload up to ${MAX_SCREENSHOTS} screenshots at a time.`, "invalid_input");
  const images = [];
  for (const file of files) {
    if (file.size > MAX_SCREENSHOT_BYTES) throw new ApiError(413, "Each screenshot must be under 5 MB.", "payload_too_large");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type) throw new ApiError(415, "Screenshots must be PNG, JPEG or WebP images.", "unsupported_media_type");
    images.push({ bytes, type });
  }

  const sb = supabaseAdmin();
  const { data: account, error } = await sb.from("linked_social_accounts").select("*").eq("id", accountId).maybeSingle();
  databaseError(error);
  if (!account || (!actor.isAdmin && !actor.aliases.includes(String(account.worker_code)))) throw new ApiError(404, "Linked account not found.");
  if (!actor.isAdmin && account.status !== "active") throw new ApiError(409, "This account is paused. Check with the team.");

  const reading = await readScreenshots(images, { platform: String(account.platform), handle: String(account.handle) });
  if (preview) return NextResponse.json({ reading }, { headers: NO_STORE_HEADERS });
  const result = await applyReading(sb, account, reading, { actorId: actor.user.id, byCreator: !actor.isAdmin, postId, imageCount: images.length });
  return NextResponse.json({ reading, ...result }, { headers: NO_STORE_HEADERS });
});
