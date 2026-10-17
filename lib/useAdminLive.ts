"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createAdminLiveCoordinator, type AdminLiveKind } from "./adminLiveCoordinator";
import { supabase } from "./supabaseClient";

export type { AdminLiveKind, AdminLiveState } from "./adminLiveCoordinator";

// The admin shell and its panels share one private channel and one visibility-aware poller.
// This coordinator carries invalidations only; data always comes from authenticated APIs.
const coordinator = createAdminLiveCoordinator({
  now: () => Date.now(),
  visible: () => !document.hidden,
  online: () => navigator.onLine,
  timeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: id => window.clearTimeout(id),
  interval: (callback, ms) => window.setInterval(callback, ms),
  clearInterval: id => window.clearInterval(id),
  listen: (event, callback) => {
    const target = event === "visibilitychange" ? document : window;
    target.addEventListener(event, callback);
    return () => target.removeEventListener(event, callback);
  },
  connect: async (onChange, onState, signal) => {
    const { data } = await supabase.auth.getSession();
    signal.throwIfAborted();
    if (!data.session) throw new Error("Admin session unavailable");
    await supabase.realtime.setAuth(data.session.access_token);
    signal.throwIfAborted();
    const channel = supabase
      .channel("admin:live", { config: { private: true } })
      .on("broadcast", { event: "changed" }, message => onChange((message.payload as { kind?: AdminLiveKind } | undefined)?.kind ?? null))
      .subscribe(status => onState(status === "SUBSCRIBED" ? "live" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting"));
    return async () => { await supabase.removeChannel(channel).catch(() => undefined); };
  },
});

/**
 * Coalesces changes over 400ms. Null requests a full refresh after polling, reconnecting,
 * or returning to the tab. Set refreshOnConnect=false when the caller already performs an initial read.
 */
export function useAdminLive(
  enabled: boolean,
  onChange: (kinds: Set<AdminLiveKind> | null) => void,
  { pollMs = 15_000, refreshOnConnect = true }: { pollMs?: number; refreshOnConnect?: boolean } = {},
) {
  const handler = useRef(onChange);
  useEffect(() => { handler.current = onChange; }, [onChange]);
  useEffect(() => {
    if (!enabled) return;
    return coordinator.subscribe(kinds => handler.current(kinds), { pollMs, refreshOnConnect });
  }, [enabled, pollMs, refreshOnConnect]);
  const state = useSyncExternalStore(coordinator.subscribeState, coordinator.getState, () => "connecting" as const);
  return enabled ? state : "offline";
}
