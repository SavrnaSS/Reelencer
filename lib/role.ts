"use client";
import { apiFetch } from "@/lib/api/client";
import { toLegacyRole } from "@/lib/roles";

export type Role = "Admin" | "Worker";

export async function getMyRole(): Promise<Role | null> {
  try {
    const response = await apiFetch("/api/me");
    if (!response.ok) return null;
    const identity = await response.json();
    return toLegacyRole(identity.role);
  } catch {
    return null;
  }
}
