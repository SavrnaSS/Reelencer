import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";

export const metadata: Metadata = publicPageMetadata({
  title: "Log in",
  description: "Log in to Reelencer to browse paid reel gigs, follow your submissions through review and withdraw your earnings.",
  path: "/login",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
