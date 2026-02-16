import { createHash, randomBytes } from "crypto";

const DEFAULT_ALLOWED_DOMAINS = ["fasterdrop.site", "reelencer.com"];

export function normalizeSecretCode(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function hashSecretCode(code: string) {
  return createHash("sha256").update(normalizeSecretCode(code)).digest("hex");
}

export function generateSecretCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return `WEC-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export function codeHint(code: string) {
  const normalized = normalizeSecretCode(code);
  if (normalized.length <= 6) return normalized;
  return `${normalized.slice(0, 4)}...${normalized.slice(-2)}`;
}

export function normalizeUsername(raw: string) {
  const value = raw.trim();
  return value.startsWith("@") ? value.slice(1) : value;
}

export function sanitizeLocalPart(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "")
    .replace(/\.{2,}/g, ".");
}

export function isValidLocalPart(localPart: string) {
  return /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(localPart);
}

export function normalizeDomain(raw: string) {
  return raw.trim().toLowerCase().replace(/\.+$/, "");
}

export function isValidDomain(domain: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain);
}

export function getAllowedWorkEmailDomains() {
  const envDomains = String(process.env.WORK_EMAIL_ALLOWED_DOMAINS || "")
    .split(",")
    .map((part) => normalizeDomain(part))
    .filter(Boolean);
  const unique = new Set<string>(envDomains.length ? envDomains : DEFAULT_ALLOWED_DOMAINS);
  return Array.from(unique);
}

