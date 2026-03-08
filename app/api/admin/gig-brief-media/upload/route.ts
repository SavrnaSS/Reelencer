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

export async function POST(req: Request) {
  const guard = await requireAdminFromBearer(req);
  if (!guard.ok) return json(guard.status, { ok: false, error: guard.error });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return json(400, { ok: false, error: "file is required." });
  }
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    return json(400, { ok: false, error: "Only image and video files are allowed." });
  }

  const ext = extFrom(file);
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const base = safeName(file.name || `brief-media.${ext}`);
  const path = `brief-media/${guard.userId}/${stamp}-${random}-${base}`;

  const sb = supabaseAdmin();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const tryUpload = async () =>
    sb.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  let { error: uploadError } = await tryUpload();
  if (uploadError && uploadError.message.toLowerCase().includes("bucket")) {
    await sb.storage.createBucket(BUCKET, { public: false });
    ({ error: uploadError } = await tryUpload());
  }

  if (uploadError) {
    return json(500, {
      ok: false,
      error: uploadError.message,
    });
  }
  const { data: signed, error: signError } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  if (signError || !signed?.signedUrl) {
    return json(500, { ok: false, error: signError?.message || "Could not create media URL." });
  }

  return json(200, { ok: true, path, url: signed.signedUrl });
}
