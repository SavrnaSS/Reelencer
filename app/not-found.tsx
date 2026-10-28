import type { Metadata } from "next";
import NotFoundView from "@/app/_components/NotFoundView";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return <NotFoundView />;
}
