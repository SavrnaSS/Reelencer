import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type DashboardFeedbackStatus = "new" | "reviewing" | "resolved" | "closed";

export type DashboardFeedbackDevRecord = {
  id: string;
  user_id: string | null;
  worker_id: string | null;
  profile_name: string | null;
  profile_role: string | null;
  section: string;
  language_code: string;
  language_name: string | null;
  category: string;
  rating: number | null;
  subject: string;
  message: string;
  allow_contact: boolean;
  status: DashboardFeedbackStatus;
  admin_note: string | null;
  source: string;
  page_url: string | null;
  meta: Record<string, string | number | boolean | null>;
  created_at: string;
  updated_at: string;
};

type DashboardFeedbackInsert = Omit<DashboardFeedbackDevRecord, "id" | "created_at" | "updated_at" | "admin_note"> & {
  admin_note?: string | null;
};

const DEV_FEEDBACK_STORE_PATH = join(tmpdir(), "reelencer-dashboard-feedback-dev.json");

function sortFeedback(items: DashboardFeedbackDevRecord[]) {
  return [...items].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function readStore() {
  try {
    const raw = await readFile(DEV_FEEDBACK_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DashboardFeedbackDevRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeStore(items: DashboardFeedbackDevRecord[]) {
  await mkdir(dirname(DEV_FEEDBACK_STORE_PATH), { recursive: true });
  await writeFile(DEV_FEEDBACK_STORE_PATH, JSON.stringify(sortFeedback(items), null, 2), "utf8");
}

export function canUseDashboardFeedbackDevStore() {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true";
}

export async function listDashboardFeedbackDev() {
  return sortFeedback(await readStore());
}

export async function insertDashboardFeedbackDev(payload: DashboardFeedbackInsert) {
  const items = await readStore();
  const now = new Date().toISOString();
  const next: DashboardFeedbackDevRecord = {
    ...payload,
    id: randomUUID(),
    admin_note: payload.admin_note ?? null,
    created_at: now,
    updated_at: now,
  };
  items.unshift(next);
  await writeStore(items);
  return next;
}

export async function updateDashboardFeedbackDev(id: string, update: { status: DashboardFeedbackStatus; admin_note: string | null }) {
  const items = await readStore();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;

  const next: DashboardFeedbackDevRecord = {
    ...items[index],
    status: update.status,
    admin_note: update.admin_note,
    updated_at: new Date().toISOString(),
  };
  items[index] = next;
  await writeStore(items);
  return next;
}
