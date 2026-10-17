import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { legacyGigAdminHref, type AdminSearchParams } from "@/lib/adminNavigation";

export const metadata: Metadata = { title: "Create a gig" };

export default async function CreateNewGigPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  redirect(legacyGigAdminHref("create-new-gig", await searchParams));
}
