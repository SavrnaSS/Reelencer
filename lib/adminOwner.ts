import "server-only";
import { getAdminEmail } from "./adminConfig";

export function normalizeOwnerEmail(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

export function isAdminOwnerEmail(value?: string | null) {
  const configured = getAdminEmail();
  return configured !== null && normalizeOwnerEmail(value) === configured;
}
