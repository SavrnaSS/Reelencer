import "server-only";
import { BlockList, isIP } from "node:net";
import { ApiError } from "./errors";

const reserved = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) reserved.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) reserved.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

/** A canonical, exact public address; never accept lists, ports, zone IDs or networks. */
export function publicClientIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let ip = value.trim();
  if (!ip || ip.length > 45 || ip.includes("%")) return null;
  let version = isIP(ip);
  if (!version) return null;
  if (version === 6) {
    ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    if (ip.startsWith("::ffff:")) {
      const parts = ip.slice(7).split(":");
      if (parts.length !== 2) return null;
      const words = parts.map(part => Number.parseInt(part, 16));
      ip = [words[0] >> 8, words[0] & 255, words[1] >> 8, words[1] & 255].join(".");
      version = 4;
    }
  }
  const family = version === 4 ? "ipv4" : "ipv6";
  if (reserved.check(ip, family) || (version === 6 && !globalV6.check(ip, "ipv6"))) return null;
  return ip;
}

const allowedHeaders = new Set(["cf-connecting-ip", "x-real-ip", "x-forwarded-for", "x-vercel-forwarded-for"]);

export function trustedIpHeader(): string | null {
  const configured = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (configured) {
    if (!allowedHeaders.has(configured)) throw new ApiError(503, "Client IP verification is not configured correctly.", "ip_configuration");
    return configured;
  }
  return process.env.VERCEL === "1" ? "x-vercel-forwarded-for" : null;
}

/** Only configure a header that the hosting edge overwrites, with direct origin access restricted. */
export function trustedClientIp(req: Request): string | null {
  const header = trustedIpHeader();
  if (!header) return null;
  const ip = publicClientIp(req.headers.get(header));
  if (!ip) throw new ApiError(503, "A verified client IP is unavailable. Please try again.", "ip_unavailable");
  return ip;
}

/** An administrator can still suspend or restore access when IP capture is unavailable. */
export function optionalTrustedClientIp(req: Request): string | null {
  try {
    return trustedClientIp(req);
  } catch (error) {
    if (error instanceof ApiError && ["ip_unavailable", "ip_configuration"].includes(error.code)) return null;
    throw error;
  }
}
