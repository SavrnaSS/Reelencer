import type { Metadata } from "next";
import GigAdminConsole from "../GigAdminConsole";

export const metadata: Metadata = { title: "KYC review" };

export default function KycReviewPage() {
  return <GigAdminConsole view="kyc-review" nextPath="/addgigs/kyc-review" />;
}
