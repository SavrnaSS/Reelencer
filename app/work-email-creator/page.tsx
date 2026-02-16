"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type WorkEmailAccount = {
  id: string;
  email: string;
  localPart: string;
  domain: string;
  username: string;
  socialPassword?: string;
  platform: string;
  notes: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type InboxMessage = {
  id: string;
  accountId: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  body: string;
  otpCode: string;
  createdAt: string;
  readAt?: string | null;
};

type AccessResponse = {
  ok: boolean;
  codeId: string;
  allowedDomains: string[];
  error?: string;
};

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function cleanInboxBody(body: string) {
  const text = body.trim();
  if (!text) return "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const dropPrefixes = [
    "delivered-to:",
    "received:",
    "x-forwarded-",
    "x-received:",
    "arc-",
    "authentication-results:",
    "dkim-signature:",
  ];

  const filtered = lines.filter((line) => !dropPrefixes.some((p) => line.toLowerCase().startsWith(p)));
  const noiseTokens = ["d=google.com", "arc-202", "dkim", "spf", "bounce", "smtp"];
  const cleanLines = filtered.filter((line) => !noiseTokens.some((t) => line.toLowerCase().includes(t)));
  const pick = (cleanLines[0] || filtered[0] || lines[0] || text).trim();
  return pick.length > 260 ? pick.slice(0, 260) : pick;
}

function isSecretCodeErrorMessage(message: string) {
  const m = message.toLowerCase();
  return m.includes("secret code") || m.includes("invalid code") || m.includes("code is blocked") || m.includes("code has expired");
}

async function authFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in first.");
  const res = await fetch(url, {
    ...(init || {}),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parsed?.error || "Request failed");
  }
  return parsed as T;
}

export default function WorkEmailCreatorPage() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [secretCodeInput, setSecretCodeInput] = useState("");
  const [secretCode, setSecretCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockErr, setUnlockErr] = useState<string | null>(null);

  const [allowedDomains, setAllowedDomains] = useState<string[]>(["fasterdrop.site"]);
  const [accounts, setAccounts] = useState<WorkEmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<InboxMessage | null>(null);
  const [refreshingInbox, setRefreshingInbox] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [socialPassword, setSocialPassword] = useState("");
  const [platform, setPlatform] = useState("Instagram");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      const hasSession = Boolean(data.session?.access_token);
      setSignedIn(hasSession);
      if (hasSession) {
        const userRes = await supabase.auth.getUser();
        if (!alive) return;
        setUserId(userRes.data.user?.id ?? "");
      } else {
        setUserId("");
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const storageKey = useMemo(() => (userId ? `wec:secret-code:${userId}` : ""), [userId]);

  const clearStoredCode = useCallback(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [storageKey]);

  const activeAccount = useMemo(
    () => accounts.find((item) => item.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const autoDomain = useMemo(() => allowedDomains[0] || "fasterdrop.site", [allowedDomains]);
  const unreadCount = useMemo(() => inbox.filter((msg) => !msg.readAt).length, [inbox]);

  const loadAccounts = useCallback(async (code: string) => {
    const data = await authFetch<{ ok: boolean; accounts: WorkEmailAccount[]; allowedDomains: string[] }>("/api/work-email/accounts", {
      method: "GET",
      headers: {
        "x-work-email-code": code,
      },
    });
    setAccounts(data.accounts ?? []);
    const domains = Array.isArray(data.allowedDomains) && data.allowedDomains.length ? data.allowedDomains : ["fasterdrop.site"];
    setAllowedDomains(domains);
    setSelectedAccountId((prev) => prev || data.accounts?.[0]?.id || "");
  }, []);

  useEffect(() => {
    if (!signedIn || !storageKey || secretCode) return;
    if (typeof window === "undefined") return;
    const savedCode = window.localStorage.getItem(storageKey)?.trim();
    if (!savedCode) return;

    let alive = true;
    setUnlocking(true);
    setUnlockErr(null);
    (async () => {
      try {
        await loadAccounts(savedCode);
        if (!alive) return;
        setSecretCode(savedCode);
        setMessage("Access restored.");
      } catch {
        if (!alive) return;
        clearStoredCode();
        setSecretCode("");
      } finally {
        if (alive) setUnlocking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [signedIn, storageKey, secretCode, loadAccounts, clearStoredCode]);

  const loadInbox = useCallback(async (code: string, accountId: string) => {
    if (!accountId) {
      setInbox([]);
      return;
    }
    setRefreshingInbox(true);
    try {
      const data = await authFetch<{ ok: boolean; inbox: InboxMessage[] }>(
        `/api/work-email/inbox?accountId=${encodeURIComponent(accountId)}&hours=48`,
        {
          method: "GET",
          headers: { "x-work-email-code": code },
        }
      );
      setInbox(data.inbox ?? []);
      setSelectedMsg((prev) => {
        if (!prev) return data.inbox?.[0] ?? null;
        const found = (data.inbox ?? []).find((msg) => msg.id === prev.id);
        return found ?? data.inbox?.[0] ?? null;
      });
      setLastSyncAt(new Date().toLocaleTimeString());
    } catch (e: unknown) {
      const msg = errorMessage(e, "Unable to load inbox.");
      if (isSecretCodeErrorMessage(msg)) {
        clearStoredCode();
        setSecretCode("");
        setUnlockErr("Stored secret code is no longer valid. Enter a new active code.");
      } else {
        setError(msg);
      }
    } finally {
      setRefreshingInbox(false);
    }
  }, [clearStoredCode]);

  const unlockAccess = useCallback(async () => {
    setUnlockErr(null);
    setMessage(null);
    if (!secretCodeInput.trim()) {
      setUnlockErr("Enter secret code.");
      return;
    }
    setUnlocking(true);
    try {
      const data = await authFetch<AccessResponse>("/api/work-email/access", {
        method: "POST",
        body: JSON.stringify({ code: secretCodeInput }),
      });
      if (!data.ok) throw new Error(data.error || "Unable to unlock.");
      const normalized = secretCodeInput.trim();
      setSecretCode(normalized);
      const domains = Array.isArray(data.allowedDomains) && data.allowedDomains.length ? data.allowedDomains : ["fasterdrop.site"];
      setAllowedDomains(domains);
      await loadAccounts(normalized);
      if (storageKey && typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, normalized);
      }
      setMessage("Access granted.");
    } catch (e: unknown) {
      setUnlockErr(errorMessage(e, "Unable to unlock."));
    } finally {
      setUnlocking(false);
    }
  }, [loadAccounts, secretCodeInput, storageKey]);

  useEffect(() => {
    if (!secretCode || !selectedAccountId) return;
    void loadInbox(secretCode, selectedAccountId);
  }, [secretCode, selectedAccountId, loadInbox]);

  useEffect(() => {
    if (!secretCode || !selectedAccountId || !autoSync) return;
    const id = window.setInterval(() => {
      void loadInbox(secretCode, selectedAccountId);
    }, 5000);
    return () => window.clearInterval(id);
  }, [secretCode, selectedAccountId, autoSync, loadInbox]);

  useEffect(() => {
    setSelectedMsg(null);
  }, [selectedAccountId]);

  const markRead = useCallback(
    async (msg: InboxMessage) => {
      if (!secretCode || !selectedAccountId || msg.readAt) return;
      try {
        await authFetch<{ ok: boolean }>("/api/work-email/inbox", {
          method: "PATCH",
          headers: { "x-work-email-code": secretCode },
          body: JSON.stringify({ accountId: selectedAccountId, messageIds: [msg.id] }),
        });
        const now = new Date().toISOString();
        setInbox((prev) => prev.map((m) => (m.id === msg.id ? { ...m, readAt: now } : m)));
        setSelectedMsg((prev) => (prev?.id === msg.id ? { ...msg, readAt: now } : prev));
      } catch {
        // ignore read-marker failures
      }
    },
    [secretCode, selectedAccountId]
  );

  const createAccount = useCallback(async () => {
    if (!secretCode) return;
    setError(null);
    setMessage(null);
    if (!username.trim()) {
      setError("Username is required.");
      return;
    }
    if (!socialPassword.trim()) {
      setError("Social account password is required.");
      return;
    }
    setWorking(true);
    try {
      const created = await authFetch<{ ok: boolean; account: WorkEmailAccount }>("/api/work-email/accounts", {
        method: "POST",
        headers: { "x-work-email-code": secretCode },
        body: JSON.stringify({
          username,
          localPart,
          domain: autoDomain,
          socialPassword,
          platform,
          notes,
        }),
      });
      if (!created?.account) throw new Error("Failed to create account.");
      setAccounts((prev) => [created.account, ...prev]);
      setSelectedAccountId(created.account.id);
      setLocalPart("");
      setSocialPassword("");
      setNotes("");
      setMessage(`Created ${created.account.email}`);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to create work email."));
    } finally {
      setWorking(false);
    }
  }, [secretCode, username, localPart, autoDomain, socialPassword, platform, notes]);

  const deleteAccount = useCallback(
    async (id: string) => {
      if (!secretCode) return;
      setError(null);
      setMessage(null);
      setWorking(true);
      try {
        await authFetch<{ ok: boolean }>(`/api/work-email/accounts/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "x-work-email-code": secretCode },
        });
        setAccounts((prev) => prev.filter((row) => row.id !== id));
        setSelectedAccountId((prev) => (prev === id ? "" : prev));
        setInbox((prev) => (activeAccount?.id === id ? [] : prev));
        setSelectedMsg((prev) => (activeAccount?.id === id ? null : prev));
      } catch (e: unknown) {
        setError(errorMessage(e, "Unable to delete this email."));
      } finally {
        setWorking(false);
      }
    },
    [secretCode, activeAccount?.id]
  );

  const markAllRead = useCallback(async () => {
    if (!secretCode || !selectedAccountId) return;
    try {
      await authFetch<{ ok: boolean }>("/api/work-email/inbox", {
        method: "PATCH",
        headers: { "x-work-email-code": secretCode },
        body: JSON.stringify({ accountId: selectedAccountId }),
      });
      await loadInbox(secretCode, selectedAccountId);
    } catch (e: unknown) {
      setError(errorMessage(e, "Unable to mark as read."));
    }
  }, [secretCode, selectedAccountId, loadInbox]);

  if (loading) {
    return <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-700">Loading...</div>;
  }

  if (!signedIn) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-lg font-bold text-slate-900">Work Email Creator</p>
          <p className="mt-2 text-sm text-slate-600">Sign in first, then enter your secret code to access this page.</p>
          <Link href="/login?next=/work-email-creator" className="mt-4 inline-block rounded-lg bg-[#0b5cab] px-4 py-2 text-sm font-semibold text-white">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xl font-bold text-slate-900">Work Email Creator</p>
                <p className="text-sm text-slate-600">Create custom work emails for social signup and verification flows.</p>
              </div>
              <Link href="/proceed" className="text-xs font-semibold text-[#0b5cab] hover:text-[#0f6bc7]">
                Back
              </Link>
            </div>

            {!secretCode && (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-800">Secret code required</p>
                <p className="mt-1 text-xs text-amber-700">Access is locked until you enter a valid admin-generated code.</p>
                <input
                  value={secretCodeInput}
                  onChange={(e) => setSecretCodeInput(e.target.value)}
                  placeholder="Enter secret code"
                  className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0b5cab]"
                />
                {unlockErr && <div className="mt-2 text-xs font-semibold text-rose-700">{unlockErr}</div>}
                <button
                  onClick={() => void unlockAccess()}
                  disabled={unlocking}
                  className="mt-3 w-full rounded-lg bg-[#0b5cab] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                >
                  {unlocking ? "Unlocking..." : "Unlock access"}
                </button>
              </div>
            )}

            {secretCode && (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                  Access unlocked.
                </div>
                <div className="grid gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Username (social handle)</label>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="username"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0b5cab]"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Custom email name</label>
                      <input
                        value={localPart}
                        onChange={(e) => setLocalPart(e.target.value)}
                        placeholder="optional; defaults from username"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0b5cab]"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Domain (auto selected)</label>
                      <div className="mt-1 flex h-[42px] items-center rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm font-semibold text-slate-800">
                        {autoDomain}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Social password</label>
                      <input
                        value={socialPassword}
                        onChange={(e) => setSocialPassword(e.target.value)}
                        placeholder="required before email creation"
                        type="password"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0b5cab]"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Platform</label>
                      <input
                        value={platform}
                        onChange={(e) => setPlatform(e.target.value)}
                        placeholder="Instagram, X, YouTube..."
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0b5cab]"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</label>
                      <input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="optional"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0b5cab]"
                      />
                    </div>
                  </div>
                </div>

                {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div>}
                {message && <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">{message}</div>}

                <button
                  onClick={() => void createAccount()}
                  disabled={working}
                  className="w-full rounded-lg bg-[#0b5cab] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                >
                  {working ? "Working..." : "Create work email"}
                </button>
              </div>
            )}
          </section>

          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">Created emails ({accounts.length})</p>
                <button
                  onClick={() => void (secretCode ? loadAccounts(secretCode) : Promise.resolve())}
                  className="text-xs font-semibold text-[#0b5cab]"
                >
                  Refresh
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className={`rounded-xl border p-3 ${selectedAccountId === acc.id ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button className="min-w-0 text-left" onClick={() => setSelectedAccountId(acc.id)}>
                        <div className="truncate text-sm font-bold text-slate-900">{acc.email}</div>
                        <div className="mt-1 text-xs text-slate-600">
                          @{acc.username} • {acc.platform}
                        </div>
                      </button>
                      <button
                        onClick={() => void deleteAccount(acc.id)}
                        className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {accounts.length === 0 && <div className="text-sm text-slate-600">No emails created yet.</div>}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">Inbox {activeAccount ? `for ${activeAccount.email}` : ""}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"} {lastSyncAt ? `• Last sync ${lastSyncAt}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => void (secretCode && selectedAccountId ? loadInbox(secretCode, selectedAccountId) : Promise.resolve())}
                    className="text-xs font-semibold text-[#0b5cab]"
                    disabled={refreshingInbox}
                  >
                    {refreshingInbox ? "Syncing..." : "Refresh"}
                  </button>
                  <button onClick={() => void markAllRead()} className="text-xs font-semibold text-slate-700" disabled={!selectedAccountId}>
                    Mark all read
                  </button>
                  <button
                    className={`h-6 w-11 rounded-full border px-1 ${autoSync ? "border-emerald-200 bg-emerald-100" : "border-slate-300 bg-slate-100"}`}
                    onClick={() => setAutoSync((v) => !v)}
                    type="button"
                    title="Auto sync"
                  >
                    <span className={`block h-4 w-4 rounded-full bg-white shadow transition ${autoSync ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
                <div className="rounded-2xl border border-slate-200 bg-white/80 p-2 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.6)]">
                  <div className="max-h-[400px] overflow-auto">
                    {inbox
                      .slice()
                      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                      .map((msg) => {
                        const isActive = selectedMsg?.id === msg.id;
                        const isUnread = !msg.readAt;
                        return (
                          <button
                            key={msg.id}
                            className={`mb-2 w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                              isActive
                                ? "border-blue-200 bg-gradient-to-r from-blue-50 to-white text-blue-900"
                                : "border-transparent bg-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                            }`}
                            onClick={() => {
                              setSelectedMsg(msg);
                              void markRead(msg);
                            }}
                            type="button"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`h-2 w-2 rounded-full ${isUnread ? "bg-blue-500" : isActive ? "bg-blue-300" : "bg-slate-200"}`} />
                                <div className="truncate font-semibold">{msg.subject || "Verification"}</div>
                              </div>
                              <div className="text-[10px] text-slate-500">{new Date(msg.createdAt).toLocaleString()}</div>
                            </div>
                            <div className="mt-1 truncate text-[10px] text-slate-400">{msg.toEmail}</div>
                            <div className="mt-1 text-slate-500">{cleanInboxBody(msg.body || "")}</div>
                            {msg.otpCode && (
                              <div className="mt-1 inline-flex rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                OTP {msg.otpCode}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    {inbox.length === 0 && (
                      <div className="px-2 py-4 text-center text-xs text-slate-500">No inbox messages for this email yet.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.6)]">
                  {selectedMsg ? (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{selectedMsg.subject || "Verification"}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {selectedMsg.fromEmail || "Unknown sender"} • {new Date(selectedMsg.createdAt).toLocaleString()}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">{selectedMsg.toEmail}</div>
                        </div>
                        <button
                          className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-400"
                          onClick={() => setSelectedMsg(null)}
                          type="button"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
                        {selectedMsg.body || "(No body)"}
                      </div>

                      {selectedMsg.otpCode && (
                        <div className="mt-3 inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                          OTP: {selectedMsg.otpCode}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex h-full min-h-[220px] items-center justify-center text-xs text-slate-500">
                      Select an email from the left to view full content.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
