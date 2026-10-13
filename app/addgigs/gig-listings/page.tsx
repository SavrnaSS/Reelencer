import type { Metadata } from "next";
import GigAdminConsole from "../GigAdminConsole";

export const metadata: Metadata = { title: "Gig listings" };

export default function GigListingsPage() {
  return <GigAdminConsole view="gig-listings" nextPath="/addgigs/gig-listings" />;
}
