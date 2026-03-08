export type AppRole = "admin" | "worker";
export type LegacyAppRole = "Admin" | "Worker";
export type AnyAppRole = AppRole | LegacyAppRole;

export function isRole(x: unknown): x is AppRole {
  return x === "admin" || x === "worker";
}

export function normalizeRole(value: unknown): AppRole | null {
  const role = String(value ?? "").trim().toLowerCase();
  return isRole(role) ? role : null;
}

export function toLegacyRole(value: unknown): LegacyAppRole | null {
  const role = normalizeRole(value);
  if (role === "admin") return "Admin";
  if (role === "worker") return "Worker";
  return null;
}

export function isAdminRole(value: unknown): boolean {
  return normalizeRole(value) === "admin";
}

export function isWorkerRole(value: unknown): boolean {
  return normalizeRole(value) === "worker";
}
