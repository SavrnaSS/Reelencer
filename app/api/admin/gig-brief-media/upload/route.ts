import { withApi } from "@/lib/api/route";
import { validateUpload } from "@/lib/api/uploads";
import { json, requireAdminFromBearer, supabaseAdmin } from "../../_utils";

export const runtime = "nodejs";
const BUCKET = "gig-brief-media";

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function extFrom(file: File) {
  const fromName = file.name.split(".").pop()?.trim().toLowerCase();
  if (fromName) return fromName;
  if (file.type.startsWith("image/")) return "jpg";
  if (file.type.startsWith("video/")) return "mp4";
  return "bin";
}

async function handlePOST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return json(400, { ok: false, error: "file is required." });
  }
  // "sample" = public sample videos shown on the gig page; "sample-poster" = their preview frames.
  const purpose = String(form.get("purpose") ?? "brief");
  if (!["brief", "sample", "sample-poster"].includes(purpose)) return json(400, { ok: false, error: "Unknown upload purpose." });
  if (purpose === "sample" && !file.type.startsWith("video/")) return json(400, { ok: false, error: "Sample uploads must be videos (MP4, WebM or MOV)." });
  if (purpose === "sample-poster" && !file.type.startsWith("image/")) return json(400, { ok: false, error: "Poster uploads must be images." });
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    return json(400, { ok: false, error: "Only image and video files are allowed." });
  }
  await validateUpload(
    file,
    purpose === "sample" ? ["video/mp4", "video/webm", "video/quicktime"] : purpose === "sample-poster" ? ["image/jpeg", "image/png", "image/webp"] : ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"],
    purpose === "sample-poster" ? 2 * 1024 * 1024 : 50 * 1024 * 1024,
  );

  const ext = extFrom(file);
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const base = safeName(file.name || `brief-media.${ext}`);
  const folder = purpose === "brief" ? "brief-media" : "samples";
  const path = `${folder}/${guard.userId}/${stamp}-${random}-${base}`;

  const sb = supabaseAdmin();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const tryUpload = async () =>
    sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      // Uploads are immutable (unique paths), so CDNs and browsers can cache them for a long time.
      cacheControl: "31536000",
      upsert: false,
    });

  const { error: uploadError } = await tryUpload();

  if (uploadError) {
    return json(500, {
      ok: false,
      error: uploadError.message,
    });
  }
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return json(200, { ok: true, path, url: data.publicUrl });
}

export const POST = withApi({ auth: "admin", maxBytes: 52 * 1024 * 1024, rateLimit: 10 }, handlePOST);
