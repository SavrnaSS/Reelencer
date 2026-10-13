import type { Metadata } from "next";
import { SITE_NAME, privatePageMetadata } from "@/lib/site";

export const metadata: Metadata = {
  ...privatePageMetadata("Gig admin console"),
  // Admin sub-pages ("KYC review", "Applications"…) keep the brand suffix.
  title: { default: "Gig admin console", template: `%s · Admin | ${SITE_NAME}` },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
