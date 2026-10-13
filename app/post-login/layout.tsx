import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/site";

export const metadata: Metadata = privatePageMetadata("Signing you in");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
