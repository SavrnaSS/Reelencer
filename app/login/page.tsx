"use client";
import { apiFetch as fetch } from "@/lib/api/client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthFeedback } from "@/app/_components/AuthFeedback";
import { AuthField, AuthShell, AuthSubmit, CarriedEmailCheck, CarriedEmailNote, PasswordToggle, authInputClass } from "@/app/_components/AuthShell";
import { toLegacyRole, type AnyAppRole } from "@/lib/roles";
import { supabase } from "@/lib/supabaseClient";
import { CREATOR_HOME_HREF } from "@/lib/routes";
import { clearAuthEmail, useCarriedEmail } from "@/lib/authEmailHandoff";
import { ResendConfirmation, requestConfirmationEmail } from "@/app/_components/ResendConfirmation";

type Role = "Admin" | "Worker";
type ProfileRow = { role?: AnyAppRole; worker_code?: string | null };
type WorkerRow = { userId?: string; workerId?: string; id?: string };
type LoginMissingField = "email" | "password";

const LS_KEYS = { AUTH: "igops:auth" } as const;

type AuthSession = {
  role: Role;
  workerId?: string;
  email?: string;
  name?: string;
  at: string;
};

function nowStamp() {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message || message === "{}" || message === "[]") return fallback;
  return message;
}

function authErrorMessage(error: { message?: string; code?: string; status?: number } | null | undefined, fallback: string) {
  const message = error?.message?.trim();

  if (error?.code === "invalid_credentials") return "Invalid email or password.";
  if (error?.code === "email_not_confirmed") return "Confirm your email before logging in.";
  if (isSupabaseNetworkFailure(error)) return "Supabase is unreachable. Check the project URL in your environment settings.";
  if (message && message !== "{}" && message !== "[]") return message;
  if (error?.status === 0) return "Unable to reach Supabase. Check the project URL and network connection.";

  return fallback;
}

function isSupabaseNetworkFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const err = error as { message?: unknown; code?: unknown; status?: unknown; name?: unknown };
  const message = String(err.message ?? "").toLowerCase();
  const code = String(err.code ?? "").toLowerCase();
  const name = String(err.name ?? "").toLowerCase();
  const status = Number(err.status ?? 0);

  return (
    code === "supabase_network_error" ||
    status === 0 ||
    status === 520 ||
    name.includes("fetch") ||
    message.includes("supabase network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("load failed") ||
    message.includes("networkerror")
  );
}

function safeNextPath(next: string | null, role: Role) {
  const fallback = role === "Admin" ? "/admin" : CREATOR_HOME_HREF;
  // Only same-site paths: "//host" and "/\\host" are protocol-relative URLs browsers treat as external.
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (role === "Admin") return next.startsWith("/admin") ? next : "/admin";
  if (next.startsWith("/admin")) return CREATOR_HOME_HREF;
  if (next === "/" || next === "/workspace") return CREATOR_HOME_HREF;
  if (next.startsWith("/workspace?") || next.startsWith("/workspace/")) {
    return next.replace(/^\/workspace/, "/dashboard");
  }
  return next;
}


function getNameFromEmail(email: string) {
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return "";
  return local.replace(/\b\w/g, (char) => char.toUpperCase());
}

function writeLocalAuth(role: Role, workerCode?: string, identity?: { email?: string | null; name?: string | null }) {
  const value: AuthSession =
    role === "Admin"
      ? {
          role: "Admin",
          email: identity?.email ? String(identity.email).trim().toLowerCase() : undefined,
          name: identity?.name ? String(identity.name).trim() : undefined,
          at: nowStamp(),
        }
      : {
          role: "Worker",
          workerId: workerCode,
          email: identity?.email ? String(identity.email).trim().toLowerCase() : undefined,
          name: identity?.name ? String(identity.name).trim() : undefined,
          at: nowStamp(),
        };
  try {
    window.localStorage.setItem(LS_KEYS.AUTH, JSON.stringify(value));
  } catch {
    // ignore localStorage errors
  }
}

function isLocalDevHost() {
  if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE !== "true" || typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function devFallbackWorkerCode(email: string) {
  const local = email
    .split("@")[0]
    ?.replace(/[^a-z0-9]+/gi, "")
    .slice(0, 8)
    .toUpperCase();
  return local ? `WKR-${local}` : "WKR-DEV";
}

function devFallbackPath(next: string | null, role: Role) {
  if (next?.startsWith("/")) return safeNextPath(next, role);
  return role === "Admin" ? "/admin" : CREATOR_HOME_HREF;
}

async function fetchOrEnsureProfile() {
  const response = await fetch("/api/bootstrap-profile", { method: "POST" });
  const data = await response.json();
  if (response.ok) return { profile: data as ProfileRow, error: null as string | null };
  return { profile: null, error: String(data.error || "Profile unavailable") };
}

async function resolveWorkerCode(profile: ProfileRow) {
  if (profile.worker_code) return profile.worker_code;

  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) return undefined;

  const workersRes = await fetch("/api/workers", { method: "GET" });
  if (!workersRes.ok) return undefined;
  const workersJson: unknown = await workersRes.json();
  if (!Array.isArray(workersJson)) return undefined;

  const workers = workersJson as WorkerRow[];
  const match = workers.find((w) => w.userId === userId);
  return match?.workerId ?? match?.id ?? undefined;
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams?.get("next") ?? null;
  const signupHref = `/signup${nextParam ? `?next=${encodeURIComponent(nextParam)}` : ""}`;
  const loginHref = `/login${nextParam ? `?next=${encodeURIComponent(nextParam)}` : ""}`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [errPulse, setErrPulse] = useState(0);
  const [infoPulse, setInfoPulse] = useState(0);
  // Set when Supabase rejects the sign-in because the address isn't confirmed yet; offers a one-tap resend.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<Partial<Record<LoginMissingField, boolean>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const signingInRef = useRef(false);

  const emailNorm = useMemo(() => email.trim().toLowerCase(), [email]);

  const nudgeAuthWarning = useCallback(() => {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }).vibrate?.([24, 34, 24]);
  }, []);

  const showAuthError = useCallback((message: string, fields: Partial<Record<LoginMissingField, boolean>> = {}) => {
    setErr(message);
    setMissingFields(fields);
    setErrPulse((current) => current + 1);
    nudgeAuthWarning();
  }, [nudgeAuthWarning]);

  const showAuthInfo = useCallback((message: string) => {
    setInfo(message);
    setInfoPulse((current) => current + 1);
  }, []);

  function clearAuthFeedback() {
    if (err) setErr(null);
    setUnconfirmedEmail(null);
    setMissingFields({});
  }

  const completeDevFallbackSignIn = () => {
    const role: Role = "Worker";
    const workerCode = role === "Worker" ? devFallbackWorkerCode(emailNorm) : undefined;
    writeLocalAuth(role, workerCode, { email: emailNorm, name: getNameFromEmail(emailNorm) });
    router.replace(devFallbackPath(nextParam, role));
  };

  // Email handed over from the homepage (or an older ?email= link): prefilled, then straight to the password.
  const [carriedEmail, setCarriedEmail] = useCarriedEmail(searchParams?.get("email"), setEmail, "login-password");
  const showCarried = Boolean(carriedEmail) && email === carriedEmail;

  useEffect(() => {
    const resetState = searchParams?.get("reset");
    if (resetState === "1") {
      showAuthInfo("Reset link verified. Enter your new password in the secure reset flow from your email.");
    } else if (resetState === "done") {
      showAuthInfo("Password updated successfully. You can sign in with your new password.");
    }
  }, [searchParams, showAuthInfo]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sessionResult = await supabase.auth.getSession().catch(() => null);
      const session = sessionResult?.data?.session ?? null;
      if (!alive || !session) return;

      const ensured = await fetchOrEnsureProfile();
      if (!alive) return;

      if (!ensured.profile) {
        showAuthError(`Signed in, but profile could not be loaded (${ensured.error || "unknown error"}).`);
        return;
      }

      const role = toLegacyRole(ensured.profile.role) ?? "Worker";
      const workerCode = await resolveWorkerCode(ensured.profile);
      if (!alive) return;
      writeLocalAuth(role, workerCode, {
        email: session.user.email,
        name: String(session.user.user_metadata?.name ?? session.user.user_metadata?.full_name ?? "").trim(),
      });
      router.replace(safeNextPath(nextParam, role));
    })();
    return () => {
      alive = false;
    };
  }, [nextParam, router, showAuthError]);

  const signIn = async () => {
    if (signingInRef.current) return;
    setErr(null);
    setInfo(null);

    if (!emailNorm || !password) {
      if (!emailNorm && !password) {
        showAuthError("Enter your work email and password to continue.", { email: true, password: true });
      } else if (!emailNorm) {
        showAuthError("Enter your work email to continue.", { email: true });
      } else {
        showAuthError("Enter your password to continue.", { password: true });
      }
      return;
    }
    setMissingFields({});

    signingInRef.current = true;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: emailNorm, password });
      if (error || !data.session) {
        if (isLocalDevHost() && isSupabaseNetworkFailure(error)) {
          completeDevFallbackSignIn();
          return;
        }
        showAuthError(authErrorMessage(error, "We could not sign you in with those credentials."));
        if (error?.code === "email_not_confirmed") setUnconfirmedEmail(emailNorm);
        return;
      }

      const ensured = await fetchOrEnsureProfile();
      if (!ensured.profile) {
        showAuthError(`Signed in, but profile could not be loaded (${ensured.error || "unknown error"}).`);
        return;
      }

      const role = toLegacyRole(ensured.profile.role) ?? "Worker";
      const workerCode = await resolveWorkerCode(ensured.profile);
      writeLocalAuth(role, workerCode, {
        email: data.session.user.email,
        name: String(data.session.user.user_metadata?.name ?? data.session.user.user_metadata?.full_name ?? "").trim(),
      });
      clearAuthEmail();
      router.replace(safeNextPath(nextParam, role));
    } catch (error) {
      if (isLocalDevHost() && isSupabaseNetworkFailure(error)) {
        completeDevFallbackSignIn();
        return;
      }
      showAuthError(errorMessage(error, "Unexpected error while signing in."));
    } finally {
      signingInRef.current = false;
      setLoading(false);
    }
  };

  const requestPasswordReset = async () => {
    setErr(null);
    setInfo(null);
    if (!emailNorm) {
      showAuthError("Enter your email first, then use ‘Forgot password?’", { email: true });
      return;
    }
    setMissingFields({});
    setResettingPassword(true);
    try {
      // Sent by the app's own mailer (branded, reliable delivery); same answer whether or not the account exists.
      const result = await requestConfirmationEmail(emailNorm, "reset");
      if (!result.ok) {
        showAuthError(result.error);
        return;
      }
      showAuthInfo(`If ${emailNorm} has an account, a reset link is on its way. Check your inbox and spam folder.`);
    } catch (error) {
      showAuthError(errorMessage(error, "Unable to send reset link right now."));
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <AuthShell
      mode="login"
      loginHref={loginHref}
      signupHref={signupHref}
      title="Log in to Reelencer"
      subtitle="Enter your email and password to open your workspace."
      footer={
        <>
          New to Reelencer?{" "}
          <Link href={signupHref} className="font-bold text-[#aef07f] transition hover:text-white">
            Create an account
          </Link>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void signIn();
        }}
        className={`auth-form-panel grid gap-4 rounded-[1.1rem] sm:gap-5 ${err ? "has-auth-error" : ""}`}
      >
        <AuthField
          id="login-email"
          label="Email address"
          icon="mail"
          invalid={missingFields.email}
          trailing={showCarried ? <CarriedEmailCheck /> : undefined}
          hint={showCarried ? <CarriedEmailNote id="login-email-carried" inputId="login-email" onChange={() => setCarriedEmail(null)} /> : undefined}
        >
          <input
            id="login-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearAuthFeedback();
            }}
            placeholder="you@example.com"
            aria-invalid={Boolean(missingFields.email)}
            aria-describedby={showCarried ? "login-email-carried" : undefined}
            className={`${authInputClass} ${showCarried ? "pr-11!" : ""}`}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
          />
        </AuthField>

        <AuthField
          id="login-password"
          label="Password"
          icon="lock"
          invalid={missingFields.password}
          trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((prev) => !prev)} />}
        >
          <input
            id="login-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearAuthFeedback();
            }}
            placeholder="Your password"
            type={showPassword ? "text" : "password"}
            aria-invalid={Boolean(missingFields.password)}
            className={`${authInputClass} pr-12`}
            autoComplete="current-password"
          />
        </AuthField>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-medium text-white/80">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-[1.1rem] w-[1.1rem] cursor-pointer rounded accent-[#58b52d]"
            />
            Remember me
          </label>
          <button
            type="button"
            onClick={() => void requestPasswordReset()}
            disabled={resettingPassword}
            className="text-sm font-bold text-[#aef07f] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resettingPassword ? "Sending reset link..." : "Forgot password?"}
          </button>
        </div>

        {err && <AuthFeedback key={`login-error-${errPulse}`} tone="error" message={err} />}
        {unconfirmedEmail && <ResendConfirmation key={unconfirmedEmail} initialEmail={unconfirmedEmail} compact />}
        {info && <AuthFeedback key={`login-info-${infoPulse}`} tone="success" message={info} />}

        <AuthSubmit loading={loading} label="Log in" loadingLabel="Logging in..." />
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#ecf4ef]" />}>
      <LoginPageInner />
    </Suspense>
  );
}
