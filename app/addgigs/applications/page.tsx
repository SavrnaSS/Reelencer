import type { Metadata } from "next";
import GigAdminConsole from "../GigAdminConsole";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage() {
  return <GigAdminConsole view="applications" nextPath="/addgigs/applications" />;
}
