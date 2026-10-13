import type { Metadata } from "next";
import GigAdminConsole from "../GigAdminConsole";

export const metadata: Metadata = { title: "Create a gig" };

export default function CreateNewGigPage() {
  return <GigAdminConsole view="create-new-gig" nextPath="/addgigs/create-new-gig" />;
}
