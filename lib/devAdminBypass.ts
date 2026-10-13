import { isAdminOwnerEmail } from "@/lib/adminOwner";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function normalizeHost(value: string | null) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end >= 0 ? raw.slice(0, end + 1) : raw;
  }
  return raw.split(":")[0] ?? "";
}

function isLocalHost(value: string | null) {
  const host = normalizeHost(value);
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}

export function isDevAdminBypassRequest(req: Request) {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.ENABLE_DEV_ADMIN_BYPASS !== "true") return false;
  if (req.headers.get("x-dev-bypass") !== "1") return false;
  if (!isAdminOwnerEmail(req.headers.get("x-dev-admin-email"))) return false;

  let urlHost = "";
  try {
    urlHost = new URL(req.url).hostname;
  } catch {
    urlHost = "";
  }

  return isLocalHost(req.headers.get("host")) && isLocalHost(urlHost);
}
