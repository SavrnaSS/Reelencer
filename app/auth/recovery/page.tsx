"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function RecoveryRedirect() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    const hash = window.location.hash || "";
    const target = `/reset-password${query ? `?${query}` : ""}${hash}`;
    window.location.replace(target);
  }, [searchParams]);

  return <RecoveryLoading />;
}

function RecoveryLoading() {
  return (
    <div className="min-h-screen bg-[#041f1a] text-white">
      <div className="relative isolate min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(45,130,105,0.22),transparent_34%),radial-gradient(circle_at_top_right,rgba(18,64,53,0.36),transparent_26%),linear-gradient(135deg,#0d4b3d_0%,#08342b_58%,#051916_100%)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(140,209,115,0.12)_1.1px,transparent_1.1px)] bg-[length:12px_12px] opacity-80" />

        <div className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-white/8 px-3 py-1 text-xs text-white/80">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-[#95ea63]" />
            Securing your recovery link...
          </div>
          <p className="mt-3 text-sm text-white/70">Please wait while we redirect you to password reset.</p>
          <Link href="/login" className="mt-5 text-sm font-semibold text-[#9eea6d] transition hover:text-white">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AuthRecoveryPage() {
  return (
    <Suspense fallback={<RecoveryLoading />}>
      <RecoveryRedirect />
    </Suspense>
  );
}
