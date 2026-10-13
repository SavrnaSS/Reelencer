import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";

export const metadata: Metadata = publicPageMetadata({
  title: "Create your free creator account",
  description: "Join Reelencer free and start earning from short-form video. Apply to paid brand gigs for Instagram Reels, YouTube Shorts and more, and get paid for approved work.",
  path: "/signup",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
