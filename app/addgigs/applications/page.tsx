import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { legacyGigAdminHref, type AdminSearchParams } from "@/lib/adminNavigation";

export const metadata: Metadata = { title: "Applications" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  redirect(legacyGigAdminHref("applications", await searchParams));
}
