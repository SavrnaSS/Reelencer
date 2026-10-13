import CreatorDashboardPage from "./CreatorDashboardPage";
import { Suspense } from "react";

export default function DashboardPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f3f4f1] p-6 text-[#616a64]" role="status">Loading your dashboard…</main>}>
      <CreatorDashboardPage />
    </Suspense>
  );
}
