import type { Metadata } from "next";
import GigAdminConsole from "../GigAdminConsole";

export const metadata: Metadata = { title: "Credential submissions" };

export default function CredentialSubmissionsPage() {
  return <GigAdminConsole view="credential-submissions" nextPath="/addgigs/credential-submissions" />;
}
