import { permanentRedirect } from "next/navigation";
import { legacyGigDestination } from "@/lib/routes";

// Keep old links usable; all gig details and work now live in the creator dashboard.
export default async function ProceedRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  permanentRedirect(legacyGigDestination(await searchParams));
}
