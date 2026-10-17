import { redirect } from "next/navigation";
import { legacyGigAdminHref, type AdminSearchParams } from "@/lib/adminNavigation";

export default async function AddGigsPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  redirect(legacyGigAdminHref("create-new-gig", await searchParams));
}
