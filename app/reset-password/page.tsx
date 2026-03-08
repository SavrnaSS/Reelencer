"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function appBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

function ResetPasswordPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [ready, setReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const emailHint = useMemo(() => searchParams.get("email")?.trim().toLowerCase() ?? "", [searchParams]);
  const [resendEmail, setResendEmail] = useState("");

  useEffect(() => {
    if (emailHint) setResendEmail(emailHint);
  }, [emailHint]);

  useEffect(() => {
    let active = true;

    const sync = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session) {
        setReady(true);
        setInvalidLink(false);
      } else {
        setReady(false);
      }
    };

    void sync();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || !!session) {
        setReady(true);
        setInvalidLink(false);
      }
    });

    const t = window.setTimeout(async () => {
      if (!active) return;
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) {
        setInvalidLink(true);
        setErr("This reset link is invalid or expired. Request a new one from login.");
      }
    }, 1800);

    return () => {
      active = false;
      window.clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async () => {
    setErr(null);
    setInfo(null);

    if (!ready) {
      setErr("Reset session is not ready yet. Re-open the email link or request a new one.");
      return;
    }

    if (!password || !confirm) {
      setErr("Enter and confirm your new password.");
      return;
    }

    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErr(error.message || "Unable to update password.");
        return;
      }

      setInfo("Password updated. Redirecting to login...");
      await supabase.auth.signOut();
      const next = emailHint ? `/login?reset=done&email=${encodeURIComponent(emailHint)}` : "/login?reset=done";
      window.setTimeout(() => router.replace(next), 700);
    } catch (error) {
      setErr(errorMessage(error, "Unable to update password."));
    } finally {
      setLoading(false);
    }
  };

  const resendResetLink = async () => {
    setErr(null);
    setInfo(null);

    const email = resendEmail.trim().toLowerCase();
    if (!email) {
      setErr("Enter your account email to resend reset link.");
      return;
    }

    setResending(true);
    try {
      const redirectTo = `${appBaseUrl()}/auth/recovery?email=${encodeURIComponent(email)}`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        setErr(error.message || "Unable to resend reset link right now.");
        return;
      }
      setInfo("A new password reset link has been sent to your email.");
      setInvalidLink(false);
    } catch (error) {
      setErr(errorMessage(error, "Unable to resend reset link right now."));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#041f1a] text-white">
      <div className="relative isolate min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(45,130,105,0.22),transparent_34%),radial-gradient(circle_at_top_right,rgba(18,64,53,0.36),transparent_26%),linear-gradient(135deg,#0d4b3d_0%,#08342b_58%,#051916_100%)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(140,209,115,0.12)_1.1px,transparent_1.1px)] bg-[length:12px_12px] opacity-80" />

        <div className="relative mx-auto w-full max-w-2xl px-4 pb-8 pt-16 sm:px-6 lg:px-8 lg:pt-24">
          <Link href="/" className="text-sm font-semibold text-[#9eea6d] transition hover:text-white">← Back to home</Link>

          <div className="mt-6 rounded-[1.65rem] border border-white/10 bg-[#113d33]/72 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-sm sm:p-8">
            <h1 className="text-[2rem] font-black tracking-[-0.03em] text-white sm:text-[2.35rem]">Reset password</h1>
            <p className="mt-2 text-sm text-white/70">Set a new password for your Reelencer account.</p>

            {!ready && !invalidLink && (
              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/18 bg-white/8 px-3 py-1 text-xs text-white/80">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-[#95ea63]" />
                Verifying reset link...
              </div>
            )}

            <div className="mt-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-white/84" htmlFor="reset-password-new">
                  New password <span className="text-[#95ea63]">*</span>
                </label>
                <div className="relative mt-2">
                  <input
                    id="reset-password-new"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type={showPassword ? "text" : "password"}
                    placeholder="At least 6 characters"
                    className="h-14 w-full rounded-[1.1rem] border border-black/8 bg-white px-5 pr-12 text-[1.02rem] font-semibold text-slate-800 outline-none placeholder:text-slate-500"
                    autoComplete="new-password"
                    disabled={!ready || loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-700/90 hover:bg-black/5"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    disabled={!ready || loading}
                  >
                    {showPassword ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-white/84" htmlFor="reset-password-confirm">
                  Confirm new password <span className="text-[#95ea63]">*</span>
                </label>
                <div className="relative mt-2">
                  <input
                    id="reset-password-confirm"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    type={showConfirm ? "text" : "password"}
                    placeholder="Re-enter new password"
                    className="h-14 w-full rounded-[1.1rem] border border-black/8 bg-white px-5 pr-12 text-[1.02rem] font-semibold text-slate-800 outline-none placeholder:text-slate-500"
                    autoComplete="new-password"
                    disabled={!ready || loading}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submit();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-700/90 hover:bg-black/5"
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                    disabled={!ready || loading}
                  >
                    {showConfirm ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              {err && <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">{err}</div>}
              {info && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{info}</div>}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!ready || loading}
                  className="inline-flex h-14 items-center justify-center rounded-[1.2rem] bg-[#8fe05f] px-8 text-lg font-extrabold tracking-[-0.02em] text-[#0b1914] transition hover:bg-[#9ae86a] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Updating..." : "Update password"}
                </button>

                <Link
                  href={emailHint ? `/login?email=${encodeURIComponent(emailHint)}` : "/login"}
                  className="text-[#9eea6d] transition hover:text-white"
                >
                  Back to login
                </Link>
              </div>

              <div className="mt-3 rounded-xl border border-white/12 bg-white/5 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/58">Need a new link?</div>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    type="email"
                    placeholder="you@company.com"
                    className="h-11 w-full rounded-lg border border-black/8 bg-white px-4 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-500"
                    autoComplete="email"
                    disabled={resending}
                  />
                  <button
                    type="button"
                    onClick={() => void resendResetLink()}
                    disabled={resending}
                    className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resending ? "Sending..." : "Resend link"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordFallback() {
  return (
    <div className="min-h-screen bg-[#041f1a] text-white">
      <div className="relative isolate min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(45,130,105,0.22),transparent_34%),radial-gradient(circle_at_top_right,rgba(18,64,53,0.36),transparent_26%),linear-gradient(135deg,#0d4b3d_0%,#08342b_58%,#051916_100%)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(140,209,115,0.12)_1.1px,transparent_1.1px)] bg-[length:12px_12px] opacity-80" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-white/8 px-3 py-1 text-xs text-white/80">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-[#95ea63]" />
            Preparing reset form...
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordPageInner />
    </Suspense>
  );
}
