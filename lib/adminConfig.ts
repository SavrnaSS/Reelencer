import "server-only";
import { z } from "zod";

const emailSchema = z.email().max(254);

type AdminEnvironment = Record<string, string | undefined>;

export function getAdminEmail(env: AdminEnvironment = process.env): string | null {
  const parsed = emailSchema.safeParse(env.ADMIN_EMAIL?.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

/** Used only by the explicit provisioning command, never returned by an API. */
export function getAdminCredentials(env: AdminEnvironment = process.env) {
  const email = getAdminEmail(env);
  if (!email) throw new Error("Configure a valid server-only ADMIN_EMAIL in .env.");
  const password = env.ADMIN_PASSWORD ?? "";
  if (password.length < 16 || password.length > 128 || password.trim().length < 16 || password.toLowerCase() === email) {
    throw new Error("ADMIN_PASSWORD must contain 16–128 characters. Generate a strong, unique password.");
  }
  const name = (env.ADMIN_NAME ?? "Reelencer Admin").trim();
  if (!name || name.length > 150) throw new Error("ADMIN_NAME must contain 1–150 characters.");
  return { email, password, name };
}
