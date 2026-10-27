"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./api/client";
import { summarizeAccountEarnings } from "./creatorEarnings";
import type { LinkedSocialAccount } from "./socialAnalytics";
import { supabase } from "./supabaseClient";
import { useVisibleRefresh } from "./useVisibleRefresh";
import { needsProfileRecovery } from "./accountProfileHealth";

type AccountData = { accounts: LinkedSocialAccount[]; accountIssues?: LinkedSocialAccount[]; statsEnabled: boolean; screenshotReader: boolean };
export type SocialAccountsLoad = { state: "loading" } | { state: "error"; message: string; unavailable?: boolean } | ({ state: "ready"; refreshError?: string } & AccountData);

/** One account collection drives account cards and earnings everywhere in the creator dashboard. */
export function useSocialAccounts(enabled: boolean, userId: string | null = null) {
  const [load, setLoad] = useState<SocialAccountsLoad>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef<{ promise: Promise<void>; sync: boolean; controller: AbortController } | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    let disposed = false;
    const revision = generation;
    queueMicrotask(() => {
      if (disposed) return;
      setLoad({ state: "loading" });
      setRefreshing(false);
    });
    return () => {
      disposed = true;
      revision.current++;
      running.current?.controller.abort();
      running.current = null;
    };
  }, [enabled, userId]);

  const refresh = useCallback(async (sync = false) => {
    if (!enabled) return;
    if (running.current) {
      const previous = running.current;
      await previous.promise;
      if (!sync || previous.sync) return;
    }
    // A queued sync and a polling tick can finish waiting at the same time.
    if (running.current) return running.current.promise;
    const controller = new AbortController();
    const version = generation.current;
    if (sync) setRefreshing(true);
    const promise = (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        if (userId && session.session?.user.id !== userId) return;
        const response = await apiFetch(`/api/social-accounts${sync ? "?sync=1" : ""}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.accounts)) {
          throw Object.assign(new Error(payload?.error || "Your accounts couldn't be loaded."), {
            unavailable: payload?.code === "schema_outdated" || response.status === 503,
          });
        }
        if (controller.signal.aborted || version !== generation.current) return;
        setLoad({ state: "ready", accounts: payload.accounts.filter((account: LinkedSocialAccount) => account.status !== "unlinked"), accountIssues: Array.isArray(payload.accountIssues) ? payload.accountIssues : [], statsEnabled: payload.statsEnabled !== false, screenshotReader: payload.screenshotReader === true });
        window.dispatchEvent(new Event("social-accounts-refreshed"));
      } catch (error) {
        if (controller.signal.aborted || version !== generation.current) return;
        const message = error instanceof Error ? error.message : "Your accounts couldn't be loaded.";
        setLoad(previous => previous.state === "ready" ? { ...previous, refreshError: message } : {
          state: "error", message, unavailable: (error as { unavailable?: boolean })?.unavailable,
        });
      } finally {
        if (running.current?.controller === controller) running.current = null;
        if (!controller.signal.aborted && sync) setRefreshing(false);
      }
    })();
    running.current = { promise, sync, controller };
    await promise;
  }, [enabled, userId]);

  const poll = useCallback(() => navigator.onLine ? refresh() : Promise.resolve(), [refresh]);
  useVisibleRefresh(poll, enabled ? 10_000 : null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let dirty = false;
    let flushing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    const schedule = () => {
      dirty = true;
      if (disposed || document.hidden || !navigator.onLine || flushing || timer !== undefined) return;
      timer = setTimeout(() => { void flush(); }, 250);
    };
    const flush = async () => {
      timer = undefined;
      if (disposed || document.hidden || !navigator.onLine) return;
      flushing = true;
      try {
        // A notification received during a read needs a new read after it, not that older response.
        await running.current?.promise;
        if (disposed || document.hidden || !navigator.onLine) return;
        dirty = false;
        await refresh();
      } finally {
        flushing = false;
        if (dirty && !disposed) schedule();
      }
    };
    const connect = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (disposed || !data.session || (userId && data.session.user.id !== userId)) return;
        await supabase.realtime.setAuth(data.session.access_token);
        if (disposed) return;
        // Only invalidations are broadcast. Account data still comes through the authenticated API.
        channel = supabase.channel(`social-accounts:${data.session.user.id}`, { config: { private: true } })
          .on("broadcast", { event: "changed" }, schedule)
          .subscribe(status => { if (status === "SUBSCRIBED") schedule(); });
      } catch { /* Saved-data polling remains available if realtime cannot connect. */ }
    };
    const wake = () => { if (!document.hidden) schedule(); };
    void connect();
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, userId, refresh]);

  const updateAccount = useCallback((account: LinkedSocialAccount) => {
    // A read started before a confirmed sync/submission must not undo that result.
    generation.current++;
    setLoad(previous => previous.state === "ready" ? {
      ...previous, refreshError: undefined,
      accounts: account.status === "unlinked" ? previous.accounts.filter(item => item.id !== account.id) : previous.accounts.some(item => item.id === account.id) ? previous.accounts.map(item => item.id === account.id ? account : item) : [account, ...previous.accounts],
      accountIssues: needsProfileRecovery(account) ? [account, ...(previous.accountIssues ?? []).filter(item => item.id !== account.id)] : (previous.accountIssues ?? []).filter(item => item.id !== account.id),
    } : previous);
    window.dispatchEvent(new Event("social-accounts-refreshed"));
  }, []);

  const updatePost = useCallback((accountId: string, post: LinkedSocialAccount["posts"][number]) => {
    generation.current++;
    setLoad(previous => previous.state === "ready" ? {
      ...previous, refreshError: undefined,
      accounts: previous.accounts.map(account => account.id === accountId ? {
        ...account, posts: [post, ...account.posts.filter(item => item.id !== post.id)],
      } : account),
    } : previous);
    window.dispatchEvent(new Event("social-accounts-refreshed"));
  }, []);

  const earnings = useMemo(() => load.state === "ready" ? summarizeAccountEarnings([...load.accounts, ...(load.accountIssues ?? [])]) : null, [load]);
  return { load, refreshing, refresh, updateAccount, updatePost, earnings };
}

export type SocialAccountsState = ReturnType<typeof useSocialAccounts>;
