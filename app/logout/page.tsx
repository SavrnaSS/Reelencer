"use client";
import { apiFetch as fetch } from "@/lib/api/client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

const LS_KEYS = { AUTH: "igops:auth", LOGOUT_AT: "igops:logoutAt" } as const;

export default function LogoutPage() {
  useEffect(() => {
    let alive = true;

    const run = () => {
      try {
        window.localStorage.removeItem(LS_KEYS.AUTH);
        window.localStorage.setItem(LS_KEYS.LOGOUT_AT, JSON.stringify({ at: Date.now() }));
      } catch {}

      try {
        window.sessionStorage.clear();
      } catch {}

      try {
        const controller = new AbortController();
        window.setTimeout(() => controller.abort(), 1200);
        void fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          signal: controller.signal,
        }).catch(() => null);
      } catch {}

      try {
        void supabase.auth.signOut({ scope: "local" }).catch(() => null);
      } catch {}

      if (!alive) return;
      window.location.replace("/login");
    };

    run();

    return () => {
      alive = false;
    };
  }, []);

  return <div className="min-h-screen bg-slate-50" />;
}
