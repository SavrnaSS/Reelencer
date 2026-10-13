import { isAdminOwnerEmail } from "@/lib/adminOwner";
import { ownedStoragePath } from "@/lib/api/uploads";
import { supabaseAdmin } from "./_utils";

const PROFILE_MEDIA_BUCKET = "worker-profile-media";
const SIGNED_URL_TTL = 60 * 60;

type SupabaseAdminClient = ReturnType<typeof supabaseAdmin>;

type StoredPresentationVideo = {
  name: string;
  uploadedAt: string;
  path: string;
  thumbnailPath?: string;
  mimeType?: string;
  size?: number;
};

type PresentationVideoRecord = Partial<Record<keyof StoredPresentationVideo, unknown>>;
type UserMetadataShape = {
  name?: unknown;
  full_name?: unknown;
  display_name?: unknown;
  workspaceProfile?: {
    presentationVideo?: PresentationVideoRecord;
  } & Record<string, unknown>;
} & Record<string, unknown>;

type AuthUserRow = {
  id: string;
  email?: string | null;
  banned_until?: string | null;
  user_metadata?: UserMetadataShape | null;
};

type WorkerRow = {
  id?: unknown;
  name?: unknown;
  email?: unknown;
  active?: unknown;
  user_id?: unknown;
  timezone?: unknown;
};

type ProfileRow = {
  id?: unknown;
  role?: unknown;
  display_name?: unknown;
  worker_code?: unknown;
  timezone?: unknown;
  email?: unknown;
  active?: unknown;
};
type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

export type AdminWorkerRecord = {
  id: string;
  userId?: string;
  name: string;
  email: string;
  active: boolean;
  timezone?: string;
  introVideo?: {
    name: string;
    uploadedAt: string;
    previewUrl?: string;
    thumbnailUrl?: string;
    mimeType?: string;
    size?: number;
  };
};

export type AdminWorkersResult = {
  workers: AdminWorkerRecord[];
  error?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function isColumnError(message?: string | null) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("column") || lower.includes("schema cache") || lower.includes("could not find");
}

function configuredSupabaseHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
}

function cleanErrorMessage(error: unknown) {
  const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : null;
  const causeRecord = cause && typeof cause === "object" ? (cause as { code?: unknown; hostname?: unknown; message?: unknown }) : null;
  const code = text(causeRecord?.code);
  const hostname = text(causeRecord?.hostname) || configuredSupabaseHost();
  if (code === "ENOTFOUND") {
    return hostname ? `Supabase host could not be resolved: ${hostname}` : "Supabase host could not be resolved";
  }
  const message = error instanceof Error ? error.message : text((error as { message?: unknown } | null)?.message) || String(error ?? "");
  const lower = message.toLowerCase();
  if (!message || message === "{}") {
    return hostname ? `Supabase host could not be reached: ${hostname}` : "Supabase host could not be reached";
  }
  if (lower.includes("fetch failed") || lower.includes("load failed") || lower.includes("network")) {
    return hostname ? `Supabase host could not be reached: ${hostname}` : "Supabase host could not be reached";
  }
  if (message) return message;
  return "Supabase request failed";
}

function combineWorkerErrors(errors: string[]) {
  const unique = Array.from(new Set(errors));
  if (unique.some((error) => error.startsWith("Supabase host could not be resolved:"))) {
    return unique.find((error) => error.startsWith("Supabase host could not be resolved:"));
  }
  if (unique.some((error) => error.startsWith("Supabase host could not be reached:"))) {
    return unique.find((error) => error.startsWith("Supabase host could not be reached:"));
  }
  return unique.join("; ");
}

function nameFromEmail(email: string) {
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return "Worker";
  return local.replace(/\b\w/g, (char) => char.toUpperCase());
}

function metadataName(meta: UserMetadataShape | null | undefined) {
  return text(meta?.display_name) || text(meta?.full_name) || text(meta?.name);
}

function isActiveFromAuth(user: AuthUserRow) {
  if (!user.banned_until) return true;
  const bannedUntil = new Date(user.banned_until);
  return Number.isNaN(bannedUntil.getTime()) || bannedUntil.getTime() <= Date.now();
}

function readStoredPresentationVideo(meta: UserMetadataShape | null | undefined): StoredPresentationVideo | null {
  const candidate = meta?.workspaceProfile?.presentationVideo;
  if (!candidate || typeof candidate !== "object") return null;
  const name = text(candidate.name);
  const uploadedAt = text(candidate.uploadedAt);
  const path = text(candidate.path);
  if (!name || !uploadedAt || !path) return null;
  return {
    name,
    uploadedAt,
    path,
    thumbnailPath: text(candidate.thumbnailPath) || undefined,
    mimeType: text(candidate.mimeType) || undefined,
    size: Number(candidate.size ?? 0) || undefined,
  };
}

async function signPresentationVideo(sb: SupabaseAdminClient, stored: StoredPresentationVideo | null, userId: string) {
  if (!stored || !ownedStoragePath(stored.path, `presentation-video/${userId}/`)) return undefined;
  const { data: previewData } = await sb.storage.from(PROFILE_MEDIA_BUCKET).createSignedUrl(stored.path, SIGNED_URL_TTL);
  const { data: thumbData } = stored.thumbnailPath && ownedStoragePath(stored.thumbnailPath, `presentation-video/${userId}/`)
    ? await sb.storage.from(PROFILE_MEDIA_BUCKET).createSignedUrl(stored.thumbnailPath, SIGNED_URL_TTL)
    : { data: undefined };
  return {
    name: stored.name,
    uploadedAt: stored.uploadedAt,
    previewUrl: previewData?.signedUrl,
    thumbnailUrl: thumbData?.signedUrl,
    mimeType: stored.mimeType,
    size: stored.size,
  };
}

async function listAuthUsers(sb: SupabaseAdminClient): Promise<{ rows: AuthUserRow[]; error?: string }> {
  const users: AuthUserRow[] = [];
  let page = 1;
  try {
    while (true) {
      const res = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (res.error) return { rows: users, error: cleanErrorMessage(res.error) };
      users.push(...rows<AuthUserRow>(res.data?.users));
      const total = res.data?.total ?? users.length;
      if (users.length >= total || rows<AuthUserRow>(res.data?.users).length === 0) break;
      page += 1;
      if (page > 50) break;
    }
    return { rows: users };
  } catch (error) {
    return { rows: users, error: cleanErrorMessage(error) };
  }
}

async function loadWorkerRows(sb: SupabaseAdminClient): Promise<{ rows: WorkerRow[]; error?: string }> {
  try {
    let res = (await sb.from("workers").select("id,name,email,active,user_id,timezone").order("id", { ascending: true })) as unknown as QueryResult;
    if (res.error && isColumnError(res.error.message)) {
      res = (await sb.from("workers").select("id,name,email,active,user_id").order("id", { ascending: true })) as unknown as QueryResult;
    }
    if (res.error && isColumnError(res.error.message)) {
      res = (await sb.from("workers").select("id,name,email,active").order("id", { ascending: true })) as unknown as QueryResult;
    }
    if (res.error) return { rows: [], error: cleanErrorMessage(res.error) };
    return { rows: rows<WorkerRow>(res.data) };
  } catch (error) {
    return { rows: [], error: cleanErrorMessage(error) };
  }
}

async function loadProfileRows(sb: SupabaseAdminClient): Promise<{ rows: ProfileRow[]; error?: string }> {
  try {
    let res = (await sb
      .from("profiles")
      .select("id,role,display_name,worker_code,timezone,email,active,created_at")
      .order("created_at", { ascending: false })) as unknown as QueryResult;
    if (res.error && isColumnError(res.error.message)) {
      res = (await sb.from("profiles").select("id,role,display_name,worker_code,timezone,created_at").order("created_at", { ascending: false })) as unknown as QueryResult;
    }
    if (res.error && isColumnError(res.error.message)) {
      res = (await sb.from("profiles").select("id,role,display_name,worker_code,created_at").order("created_at", { ascending: false })) as unknown as QueryResult;
    }
    if (res.error) return { rows: [], error: cleanErrorMessage(res.error) };
    return { rows: rows<ProfileRow>(res.data) };
  } catch (error) {
    return { rows: [], error: cleanErrorMessage(error) };
  }
}

function makeWorkerFromParts(input: {
  authUser?: AuthUserRow;
  worker?: WorkerRow;
  profile?: ProfileRow;
  fallbackKey: string;
  introVideo?: AdminWorkerRecord["introVideo"];
}): AdminWorkerRecord | null {
  const userId = text(input.authUser?.id) || text(input.worker?.user_id) || text(input.profile?.id);
  const email = text(input.worker?.email) || text(input.profile?.email) || text(input.authUser?.email);
  if (isAdminOwnerEmail(email)) return null;

  const id = text(input.profile?.worker_code) || text(input.worker?.id) || userId || input.fallbackKey;
  if (!id) return null;

  const name =
    text(input.profile?.display_name) ||
    text(input.worker?.name) ||
    metadataName(input.authUser?.user_metadata) ||
    (email ? nameFromEmail(email) : "Worker");
  const active = optionalBoolean(input.worker?.active) ?? optionalBoolean(input.profile?.active) ?? (input.authUser ? isActiveFromAuth(input.authUser) : true);
  const timezone = text(input.profile?.timezone) || text(input.worker?.timezone) || undefined;

  return {
    id,
    userId: userId || undefined,
    name,
    email,
    active,
    timezone,
    introVideo: input.introVideo,
  };
}

export async function getAdminWorkersResult(sb: SupabaseAdminClient): Promise<AdminWorkersResult> {
  const [authResult, workerResult, profileResult] = await Promise.all([listAuthUsers(sb), loadWorkerRows(sb), loadProfileRows(sb)]);
  const authUsers = authResult.rows;
  const workerRows = workerResult.rows;
  const profileRows = profileResult.rows;
  const errors = [authResult.error, workerResult.error, profileResult.error].filter((error): error is string => !!error);
  const authById = new Map(authUsers.map((user) => [text(user.id), user]));
  const workersByUserId = new Map<string, WorkerRow>();
  const workersById = new Map<string, WorkerRow>();
  const profilesById = new Map<string, ProfileRow>();
  const profilesByWorkerCode = new Map<string, ProfileRow>();

  for (const worker of workerRows) {
    const userId = text(worker.user_id);
    const id = text(worker.id);
    if (userId) workersByUserId.set(userId, worker);
    if (id) workersById.set(id, worker);
  }

  for (const profile of profileRows) {
    const id = text(profile.id);
    const workerCode = text(profile.worker_code);
    if (id) profilesById.set(id, profile);
    if (workerCode) profilesByWorkerCode.set(workerCode, profile);
  }

  const merged = new Map<string, AdminWorkerRecord>();

  for (const authUser of authUsers) {
    if (isAdminOwnerEmail(authUser.email)) continue;
    const introVideo = await signPresentationVideo(sb, readStoredPresentationVideo(authUser.user_metadata), authUser.id).catch(() => undefined);
    const userId = text(authUser.id);
    const worker = workersByUserId.get(userId);
    const profile = profilesById.get(userId);
    const record = makeWorkerFromParts({ authUser, worker, profile, fallbackKey: userId, introVideo });
    if (record) merged.set(record.id, record);
  }

  for (const worker of workerRows) {
    const userId = text(worker.user_id);
    if (userId && authById.has(userId)) continue;
    const id = text(worker.id);
    const profile = (userId ? profilesById.get(userId) : null) ?? profilesByWorkerCode.get(id);
    const record = makeWorkerFromParts({ worker, profile, fallbackKey: id });
    if (record) merged.set(record.id, record);
  }

  for (const profile of profileRows) {
    const userId = text(profile.id);
    const workerCode = text(profile.worker_code);
    if ((userId && authById.has(userId)) || (workerCode && workersById.has(workerCode))) continue;
    const record = makeWorkerFromParts({ profile, fallbackKey: workerCode || userId });
    if (record) merged.set(record.id, record);
  }

  const workers = Array.from(merged.values()).sort((left, right) => {
    const leftName = left.name || left.email || left.id;
    const rightName = right.name || right.email || right.id;
    return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
  });

  return {
    workers,
    error: errors.length ? combineWorkerErrors(errors) : undefined,
  };
}

export async function getAdminWorkers(sb: SupabaseAdminClient): Promise<AdminWorkerRecord[]> {
  return (await getAdminWorkersResult(sb)).workers;
}
