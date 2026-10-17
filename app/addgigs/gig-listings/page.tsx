import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { legacyGigAdminHref, type AdminSearchParams } from "@/lib/adminNavigation";

export const metadata: Metadata = { title: "Gig listings" };

export default async function GigListingsPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  redirect(legacyGigAdminHref("gig-listings", await searchParams));
}
