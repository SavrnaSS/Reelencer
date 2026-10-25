import { isAdminOwnerEmail } from "@/lib/adminOwner";
import { ownedStoragePath } from "@/lib/api/uploads";
import { supabaseAdmin } from "./_utils";
import { workerPurgeAfter } from "@/lib/workerDeletion";

const PROFILE_MEDIA_BUCKET = "worker-profile-media";
const SIGNED_URL_TTL = 60 * 60;
const DIRECTORY_PAGE_SIZE = 1000;
const DIRECTORY_ROW_LIMIT = 10_000;
const DIRECTORY_PAGE_LIMIT = 101;
const INCOMPLETE_DIRECTORY = "The complete user directory could not be loaded safely. Refresh before managing users.";

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
type LoadedRows<T> = { rows: T[]; error?: string };
type ModerationRow = { user_id: string; status: "active" | "suspended" | "deleted"; deleted_at?: string; purge_started_at?: string };

export type AdminWorkerRecord = {
  id: string;
  userId?: string;
  name: string;
  email: string;
  active: boolean;
  moderationStatus?: "active" | "suspended" | "deleted";
  deletedAt?: string;
  purgeAfter?: string;
  purgeStartedAt?: string;
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
  const seen = new Set<string>();
  try {
    // One final page probes an exact 10,000-user boundary when Auth omits totals.
    for (let page = 1; page <= 51; page += 1) {
      const res = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (res.error) return { rows: users, error: cleanErrorMessage(res.error) };
      if (!Array.isArray(res.data?.users)) return { rows: users, error: INCOMPLETE_DIRECTORY };
      const batch = rows<AuthUserRow>(res.data.users);
      const hasMore = Number(res.data.total) > users.length + batch.length || Number(res.data.nextPage) > page || Number(res.data.lastPage) > page;
      if (users.length + batch.length > DIRECTORY_ROW_LIMIT) return { rows: users, error: INCOMPLETE_DIRECTORY };
      for (const user of batch) {
        if (!text(user.id) || seen.has(user.id)) return { rows: users, error: INCOMPLETE_DIRECTORY };
        seen.add(user.id);
      }
      users.push(...batch);
      if (batch.length === 0) return hasMore ? { rows: users, error: INCOMPLETE_DIRECTORY } : { rows: users };
      if (batch.length < 200 && !hasMore) return { rows: users };
    }
    return { rows: users, error: INCOMPLETE_DIRECTORY };
  } catch (error) {
    return { rows: users, error: cleanErrorMessage(error) };
  }
}

async function loadDirectoryRows<T>(sb: SupabaseAdminClient, table: string, columns: readonly string[],
  order: readonly { column: string; ascending: boolean }[], identity: string): Promise<LoadedRows<T>> {
  const loaded: T[] = [];
  const seen = new Set<string>();
  let variant = 0;
  try {
    for (let page = 0; page < DIRECTORY_PAGE_LIMIT; page += 1) {
      let res: QueryResult;
      for (;;) {
        let query = sb.from(table).select(columns[variant]);
        for (const item of order) query = query.order(item.column, { ascending: item.ascending });
        res = await query.range(loaded.length, Math.min(loaded.length + DIRECTORY_PAGE_SIZE - 1, DIRECTORY_ROW_LIMIT));
        if (res.error && isColumnError(res.error.message) && variant + 1 < columns.length) { variant += 1; continue; }
        break;
      }
      if (res.error) return { rows: loaded, error: cleanErrorMessage(res.error) };
      if (!Array.isArray(res.data)) return { rows: loaded, error: INCOMPLETE_DIRECTORY };
      const batch = rows<T>(res.data);
      if (!batch.length) return { rows: loaded };
      if (loaded.length + batch.length > DIRECTORY_ROW_LIMIT) return { rows: loaded, error: INCOMPLETE_DIRECTORY };
      for (const row of batch) {
        const id = text((row as Record<string, unknown>)[identity]);
        if (!id || seen.has(id)) return { rows: loaded, error: INCOMPLETE_DIRECTORY };
        seen.add(id);
      }
      loaded.push(...batch);
      // Continue from the number actually received: a project may configure a
      // PostgREST response cap lower than our requested page size.
    }
    return { rows: loaded, error: INCOMPLETE_DIRECTORY };
  } catch (error) {
    return { rows: loaded, error: cleanErrorMessage(error) };
  }
}

function loadWorkerRows(sb: SupabaseAdminClient) {
  return loadDirectoryRows<WorkerRow>(sb, "workers", ["id,name,email,active,user_id,timezone", "id,name,email,active,user_id", "id,name,email,active"], [{ column: "id", ascending: true }], "id");
}

function loadProfileRows(sb: SupabaseAdminClient) {
  return loadDirectoryRows<ProfileRow>(sb, "profiles", ["id,role,display_name,worker_code,timezone,email,active,created_at", "id,role,display_name,worker_code,timezone,created_at", "id,role,display_name,worker_code,created_at"], [{ column: "created_at", ascending: false }, { column: "id", ascending: true }], "id");
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
  const active = optionalBoolean(input.worker?.active) !== false && optionalBoolean(input.profile?.active) !== false && (!input.authUser || isActiveFromAuth(input.authUser));
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
  const [authResult, workerResult, profileResult, moderationResult] = await Promise.all([
    listAuthUsers(sb), loadWorkerRows(sb), loadProfileRows(sb), loadDirectoryRows<ModerationRow>(sb, "worker_moderation", ["user_id,status,deleted_at,purge_started_at"], [{ column: "user_id", ascending: true }], "user_id"),
  ]);
  const authUsers = authResult.rows;
  const workerRows = workerResult.rows;
  const profileRows = profileResult.rows;
  const errors = [authResult.error, workerResult.error, profileResult.error].filter((error): error is string => !!error);
  if (moderationResult.error) errors.push("User access details could not be loaded completely. Refresh after checking the database connection and migrations.");
  // Never infer access from partial identity or moderation sources. An omitted
  // restriction must not turn an archived or suspended account into an active row.
  if (errors.length) return { workers: [], error: combineWorkerErrors(errors) };
  const moderationByUserId = new Map(moderationResult.rows.map(row => [row.user_id, row]));
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

  const workers = Array.from(merged.values()).map(record => {
    const moderation = record.userId ? moderationByUserId.get(record.userId) : undefined;
    const status = moderation?.status;
    return { ...record, active: record.active && (!status || status === "active"), moderationStatus: status && status !== "active" ? status : record.active ? "active" as const : "suspended" as const,
      ...(status === "deleted" ? { deletedAt: moderation?.deleted_at, purgeAfter: workerPurgeAfter(moderation?.deleted_at), purgeStartedAt: moderation?.purge_started_at } : {}) };
  }).sort((left, right) => {
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
