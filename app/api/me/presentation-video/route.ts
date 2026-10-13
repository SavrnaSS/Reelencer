import { withApi } from "@/lib/api/route";
import { ownedStoragePath, validateUpload } from "@/lib/api/uploads";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getRoleForUser } from "@/lib/auth";

export const runtime = "nodejs";

const BUCKET = "worker-profile-media";
const SIGNED_URL_TTL = 60 * 60;

type StoredPresentationVideo = {
  name: string;
  uploadedAt: string;
  path: string;
  thumbnailPath?: string;
  mimeType?: string;
  size?: number;
};

type PresentationVideoRecord = Partial<Record<keyof StoredPresentationVideo, unknown>>;
type WorkspaceProfileMetadata = {
  presentationVideo?: PresentationVideoRecord;
} & Record<string, unknown>;
type UserMetadataShape = {
  workspaceProfile?: WorkspaceProfileMetadata;
} & Record<string, unknown>;

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

function readStoredVideo(user: { id: string; user_metadata?: UserMetadataShape | null }): StoredPresentationVideo | null {
  const candidate = user.user_metadata?.workspaceProfile?.presentationVideo;
  if (!candidate || typeof candidate !== "object") return null;
  const path = String(candidate.path ?? "").trim();
  const name = String(candidate.name ?? "").trim();
  const uploadedAt = String(candidate.uploadedAt ?? "").trim();
  if (!path || !name || !uploadedAt) return null;
  if (!ownedStoragePath(path, `presentation-video/${user.id}/`)) return null;
  const thumb = String(candidate.thumbnailPath ?? "").trim();
  return {
    name,
    uploadedAt,
    path,
    thumbnailPath: thumb && ownedStoragePath(thumb, `presentation-video/${user.id}/`) ? thumb : undefined,
    mimeType: String(candidate.mimeType ?? "").trim() || undefined,
    size: Number(candidate.size ?? 0) || undefined,
  };
}

async function signPath(sb: ReturnType<typeof supabaseAdmin>, path?: string) {
  if (!path) return undefined;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return undefined;
  return data.signedUrl;
}

function buildResponseMeta(meta: StoredPresentationVideo, previewUrl?: string, thumbnailUrl?: string) {
  return {
    name: meta.name,
    uploadedAt: meta.uploadedAt,
    path: meta.path,
    thumbnailPath: meta.thumbnailPath,
    mimeType: meta.mimeType,
    size: meta.size,
    previewUrl,
    thumbnailUrl,
  };
}

async function removeStoredObjects(sb: ReturnType<typeof supabaseAdmin>, meta: StoredPresentationVideo | null) {
  const paths = [meta?.path, meta?.thumbnailPath].filter(Boolean) as string[];
  if (!paths.length) return;
  await sb.storage.from(BUCKET).remove(paths);
}

async function uploadWithBucketFallback(
  sb: ReturnType<typeof supabaseAdmin>,
  path: string,
  bytes: Uint8Array,
  contentType: string
) {
  const attempt = () =>
    sb.storage.from(BUCKET).upload(path, bytes, {
      contentType,
      upsert: false,
    });

  return attempt();
}

async function getAuthedUser(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ ok: false, error: "Missing Authorization" }, { status: 401 }) };
  }

  const token = authHeader.slice("Bearer ".length);
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return { error: NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 }) };
  }

  const role = await getRoleForUser(data.user.id);
  if (!role) {
    return { error: NextResponse.json({ ok: false, error: "No profile role found" }, { status: 403 }) };
  }

  return { admin, user: data.user };
}

async function handleGET(req: Request) {
  const auth = await getAuthedUser(req);
  if ("error" in auth) return auth.error;

  const stored = readStoredVideo(auth.user);
  if (!stored) return NextResponse.json({ ok: true, introVideo: null });

  const [previewUrl, thumbnailUrl] = await Promise.all([
    signPath(auth.admin, stored.path),
    signPath(auth.admin, stored.thumbnailPath),
  ]);

  return NextResponse.json({
    ok: true,
    introVideo: buildResponseMeta(stored, previewUrl, thumbnailUrl),
  });
}

async function handlePOST(req: Request) {
  const auth = await getAuthedUser(req);
  if ("error" in auth) return auth.error;

  const form = await req.formData();
  const file = form.get("file");
  const thumbnail = form.get("thumbnail");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "file is required." }, { status: 400 });
  }
  if (!file.type.startsWith("video/")) {
    return NextResponse.json({ ok: false, error: "Only video files are allowed." }, { status: 400 });
  }
  await validateUpload(file, ["video/mp4", "video/webm", "video/quicktime"], 50 * 1024 * 1024);
  if (thumbnail instanceof File) await validateUpload(thumbnail, ["image/jpeg", "image/png"], 2 * 1024 * 1024);

  const previous = readStoredVideo(auth.user);
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const ext = extFrom(file);
  const base = safeName(file.name || `presentation-video.${ext}`);
  const videoPath = `presentation-video/${auth.user.id}/${stamp}-${random}-${base}`;

  const videoBytes = new Uint8Array(await file.arrayBuffer());
  const { error: videoUploadError } = await uploadWithBucketFallback(
    auth.admin,
    videoPath,
    videoBytes,
    file.type || "application/octet-stream"
  );
  if (videoUploadError) {
    return NextResponse.json({ ok: false, error: videoUploadError.message }, { status: 500 });
  }

  let thumbnailPath: string | undefined;
  if (thumbnail instanceof File && thumbnail.type.startsWith("image/")) {
    const thumbExt = extFrom(thumbnail);
    const thumbPath = `presentation-video/${auth.user.id}/thumbnails/${stamp}-${random}-thumb.${thumbExt}`;
    const thumbBytes = new Uint8Array(await thumbnail.arrayBuffer());
    const { error: thumbUploadError } = await uploadWithBucketFallback(
      auth.admin,
      thumbPath,
      thumbBytes,
      thumbnail.type || "image/jpeg"
    );
    if (!thumbUploadError) thumbnailPath = thumbPath;
  }

  const stored: StoredPresentationVideo = {
    name: file.name,
    uploadedAt: new Date().toISOString(),
    path: videoPath,
    thumbnailPath,
    mimeType: file.type || undefined,
    size: file.size || undefined,
  };

  const nextUserMetadata: UserMetadataShape = {
    ...((auth.user.user_metadata ?? {}) as UserMetadataShape),
    workspaceProfile: {
      ...(((auth.user.user_metadata ?? {}) as UserMetadataShape).workspaceProfile ?? {}),
      presentationVideo: stored,
    },
  };

  const { error: updateError } = await auth.admin.auth.admin.updateUserById(auth.user.id, {
    user_metadata: nextUserMetadata,
  });
  if (updateError) {
    await removeStoredObjects(auth.admin, stored);
    return NextResponse.json({ ok: false, error: updateError.message || "Unable to save video metadata." }, { status: 500 });
  }

  await removeStoredObjects(auth.admin, previous);

  const [previewUrl, thumbnailUrl] = await Promise.all([
    signPath(auth.admin, stored.path),
    signPath(auth.admin, stored.thumbnailPath),
  ]);

  return NextResponse.json({
    ok: true,
    introVideo: buildResponseMeta(stored, previewUrl, thumbnailUrl),
  });
}

async function handleDELETE(req: Request) {
  const auth = await getAuthedUser(req);
  if ("error" in auth) return auth.error;

  const previous = readStoredVideo(auth.user);
  const currentMetadata = ((auth.user.user_metadata ?? {}) as UserMetadataShape).workspaceProfile ?? {};
  const nextWorkspaceProfile = Object.fromEntries(
    Object.entries(currentMetadata).filter(([key]) => key !== "presentationVideo")
  ) as WorkspaceProfileMetadata;

  const nextUserMetadata: UserMetadataShape = {
    ...((auth.user.user_metadata ?? {}) as UserMetadataShape),
    workspaceProfile: nextWorkspaceProfile,
  };

  const { error: updateError } = await auth.admin.auth.admin.updateUserById(auth.user.id, {
    user_metadata: nextUserMetadata,
  });
  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message || "Unable to remove video metadata." }, { status: 500 });
  }

  await removeStoredObjects(auth.admin, previous);
  return NextResponse.json({ ok: true });
}

export const GET = withApi({ auth: "user", maxBytes: 52 * 1024 * 1024, rateLimit: 10 }, handleGET);

export const POST = withApi({ auth: "user", maxBytes: 52 * 1024 * 1024, rateLimit: 10 }, handlePOST);

export const DELETE = withApi({ auth: "user", maxBytes: 52 * 1024 * 1024, rateLimit: 10 }, handleDELETE);
