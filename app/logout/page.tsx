"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

const LS_KEYS = { AUTH: "igops:auth" } as const;

export default function LogoutPage() {
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        await supabase.auth.signOut();
      } catch {}

      try {
        window.localStorage.removeItem(LS_KEYS.AUTH);
      } catch {}

      if (!alive) return;
      window.location.replace("/login");
    })();

    return () => {
      alive = false;
    };
  }, []);

  return <div className="min-h-screen bg-slate-50" />;
}
