import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { legacyGigAdminHref, type AdminSearchParams } from "@/lib/adminNavigation";

export const metadata: Metadata = { title: "Credential submissions" };

export default async function CredentialSubmissionsPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  redirect(legacyGigAdminHref("credential-submissions", await searchParams));
}
