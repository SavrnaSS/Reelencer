"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { bindCreatorCacheIdentity, creatorCacheIdentity, CREATOR_CACHE_CLEARED, CREATOR_CACHE_OWNER, detachCreatorCacheIdentity } from "./creatorDeviceCache";

export type PayoutIdentityState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; userId: string; workerId: string };

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const VERIFY_TIMEOUT_MS = 20_000;

/** Bound the session read as well as HTTP: an auth lock must not leave payouts loading forever. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Request cancelled", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

/** Verify the owner before mounting any payout data or restoring their private earnings cache. */
export function usePayoutIdentity(): { state: PayoutIdentityState; retry: () => void } {
  const [state, setState] = useState<PayoutIdentityState>({ state: "loading" });
  const retryRef = useRef<() => void>(() => {});
  const retry = useCallback(() => retryRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let controller: AbortController | null = null;
    let expectedUserId: string | null = null;
    let verifiedUserId: string | null = null;
    let scheduled = false;

    const login = () => window.location.replace("/login?next=/payouts");
    const discardIdentity = () => {
      if (verifiedUserId && creatorCacheIdentity() === verifiedUserId) detachCreatorCacheIdentity(false);
      verifiedUserId = null;
    };
    const invalidate = () => {
      revision++;
      controller?.abort();
      controller = null;
      discardIdentity();
      setState({ state: "loading" });
    };

    const verify = async () => {
      if (disposed) return;
      const attempt = ++revision;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const timeout = window.setTimeout(() => request.abort(new DOMException("Identity check timed out", "TimeoutError")), VERIFY_TIMEOUT_MS);
      const current = () => !disposed && attempt === revision && !request.signal.aborted;
      setState({ state: "loading" });
      try {
        const restored = await abortable(supabase.auth.getSession(), request.signal);
        if (!current()) return;
        if (restored.error) throw new Error("Your session could not be restored. Check your connection and try again.");
        const session = restored.data.session;
        if (!session?.access_token || !session.user?.id) {
          discardIdentity();
          login();
          return;
        }
        const scope = session.user.id;
        expectedUserId = scope;
        if (verifiedUserId && verifiedUserId !== scope) discardIdentity();
        // Explicit token avoids another auth read while bootstrapping. The server verifies identity and role;
        // igops:auth and the cache-owner marker are display storage and never grant access.
        const response = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
          signal: request.signal,
        });
        const payload: unknown = await response.json();
        if (!current()) return;
        if (response.status === 401) {
          discardIdentity();
          login();
          return;
        }
        const profile = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
        if (!response.ok) throw new Error(typeof profile?.error === "string" ? profile.error : "Your payout account could not be verified. Please try again.");
        if (!UUID.test(scope) || profile?.id !== scope) throw new Error("Your session changed. Please try again to verify your payout account.");
        if (profile.role === "admin") {
          discardIdentity();
          window.location.replace("/admin");
          return;
        }
        if (profile.role !== "worker") throw new Error("Payouts are available to creator accounts. Open your dashboard or contact support for help.");
        const workerId = typeof profile.workerId === "string" ? profile.workerId.trim() : "";
        if (!workerId) throw new Error("Your creator profile is not linked yet. Open your dashboard to finish setup, or contact support, then try again.");
        // Auth may have changed while /api/me was in flight, even before its callback is delivered.
        const latest = await abortable(supabase.auth.getSession(), request.signal);
        if (!current()) return;
        if (latest.error) throw new Error("Your session could not be verified. Check your connection and try again.");
        if (latest.data.session?.user.id !== scope) {
          invalidate();
          schedule();
          return;
        }
        bindCreatorCacheIdentity(scope);
        verifiedUserId = scope;
        setState({ state: "ready", userId: scope, workerId });
      } catch (error) {
        if (disposed || attempt !== revision) return;
        setState({
          state: "error",
          message: request.signal.aborted
            ? "Account verification took too long. Check your connection and try again."
            : error instanceof TypeError || error instanceof SyntaxError
              ? "Your payout account could not be verified. Check your connection and try again."
              : error instanceof Error ? error.message : "Your payout account could not be verified. Please try again.",
        });
      } finally {
        window.clearTimeout(timeout);
        if (controller === request) controller = null;
      }
    };

    // Supabase holds its auth lock while dispatching callbacks. Defer session/API work until it releases it.
    const schedule = () => {
      if (disposed || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!disposed) void verify();
      });
    };
    retryRef.current = schedule;
    const auth = supabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      const nextUserId = session?.user.id ?? null;
      // Refreshing a token, focusing another tab, or updating the same user's metadata must not blank the page.
      if (event === "INITIAL_SESSION") return;
      if (nextUserId && nextUserId === (verifiedUserId ?? expectedUserId)) return;
      invalidate();
      expectedUserId = nextUserId;
      if (event === "SIGNED_OUT") queueMicrotask(() => { if (!disposed) login(); });
      else schedule();
    });
    const cleared = () => {
      if (disposed) return;
      invalidate();
      expectedUserId = null;
      login();
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== CREATOR_CACHE_OWNER || !verifiedUserId || event.newValue === verifiedUserId) return;
      invalidate();
      expectedUserId = null;
      schedule();
    };
    window.addEventListener(CREATOR_CACHE_CLEARED, cleared);
    window.addEventListener("storage", storage);
    schedule();
    return () => {
      disposed = true;
      revision++;
      controller?.abort();
      retryRef.current = () => {};
      auth.data.subscription.unsubscribe();
      window.removeEventListener(CREATOR_CACHE_CLEARED, cleared);
      window.removeEventListener("storage", storage);
    };
  }, []);

  return { state, retry };
}
