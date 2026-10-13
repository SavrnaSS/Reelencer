"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

// Live admin consoles (migration 202610110002): one private "admin:live" broadcast topic, readable by admins only.
// Each signal names the kind of record that changed (its table); consoles re-read through their admin APIs.
// When the channel isn't connected, a light poll keeps the console fresh.

export type AdminLiveKind =
  | "upi_configs"
  | "worker_kyc"
  | "payout_batches"
  | "view_payout_claims"
  | "social_account_requests"
  | "work_items"
  | "gig_applications"
  | "gig_assignments"
  | "gig_account_credentials";
export type AdminLiveState = "connecting" | "live" | "offline";

/**
 * Calls `onChange(kinds)` (coalesced over ~400ms) when the given record kinds change, and `onChange(null)` on
 * fallback polls, returning from hidden tabs, or reconnecting (null means "refresh everything you show").
 */
export function useAdminLive(enabled: boolean, onChange: (kinds: Set<AdminLiveKind> | null) => void, { pollMs = 15_000 }: { pollMs?: number } = {}) {
  const [state, setState] = useState<AdminLiveState>("connecting");
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let live = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timer: number | null = null;
    let pending: Set<AdminLiveKind> | null = new Set();

    const flush = () => {
      timer = null;
      if (disposed || document.hidden) return;
      const kinds = pending;
      pending = new Set();
      handler.current(kinds && kinds.size ? kinds : null);
    };
    const queue = (kind: AdminLiveKind | null) => {
      if (kind === null) pending = null;
      else pending?.add(kind);
      if (timer === null) timer = window.setTimeout(flush, 400);
    };

    const connect = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (disposed || !data.session) return;
        await supabase.realtime.setAuth(data.session.access_token);
        if (disposed) return;
        channel = supabase
          .channel("admin:live", { config: { private: true } })
          .on("broadcast", { event: "changed" }, (message) => queue(((message.payload as { kind?: AdminLiveKind } | undefined)?.kind ?? null) as AdminLiveKind | null))
          .subscribe((status) => {
            if (disposed) return;
            const wasLive = live;
            live = status === "SUBSCRIBED";
            setState(live ? "live" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting");
            // Catch up on anything missed while (re)connecting.
            if (live && !wasLive) queue(null);
          });
      } catch {
        if (!disposed) setState("offline");
      }
    };
    void connect();

    const wake = () => {
      if (!document.hidden && navigator.onLine) queue(null);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    // Fallback poll: frequent while disconnected, occasional while live.
    let ticks = 0;
    const poll = window.setInterval(() => {
      ticks += 1;
      if (document.hidden || !navigator.onLine) return;
      if (!live || ticks % 8 === 0) queue(null);
    }, pollMs);

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, pollMs]);

  return state;
}
