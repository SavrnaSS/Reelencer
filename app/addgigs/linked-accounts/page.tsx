import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { legacyGigAdminHref, type AdminSearchParams } from "@/lib/adminNavigation";

export const metadata: Metadata = { title: "Linked accounts" };

export default async function LinkedAccountsPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  redirect(legacyGigAdminHref("linked-accounts", await searchParams));
}
