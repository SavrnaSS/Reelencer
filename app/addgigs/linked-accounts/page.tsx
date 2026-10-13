import type { Metadata } from "next";
import GigAdminConsole from "../GigAdminConsole";

export const metadata: Metadata = { title: "Linked accounts" };

export default function LinkedAccountsPage() {
  return <GigAdminConsole view="linked-accounts" nextPath="/addgigs/linked-accounts" />;
}
