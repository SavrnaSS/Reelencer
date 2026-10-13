"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthFeedback } from "@/app/_components/AuthFeedback";
import { AuthField, AuthShell, AuthSubmit, PasswordToggle, authInputClass } from "@/app/_components/AuthShell";
import { ResendConfirmation } from "@/app/_components/ResendConfirmation";
import { readAuthEmail, stashAuthEmail } from "@/lib/authEmailHandoff";
import { confirmState, passwordStrength } from "@/lib/passwordStrength";
import { supabase } from "@/lib/supabaseClient";

type Phase = "checking" | "ready" | "invalid" | "done";

const loginHref = "/login?next=/";
const signupHref = "/signup?next=/";

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Older reset emails put the address in the URL; newer ones hand it over in-tab.
  const emailHint = useMemo(() => searchParams?.get("email")?.trim().toLowerCase() ?? "", [searchParams]);

  const [phase, setPhase] = useState<Phase>("checking");
  const [accountEmail, setAccountEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<{ text: string; n: number } | null>(null);
  const [missing, setMissing] = useState<{ password?: boolean; confirm?: boolean }>({});

  // A reset link signs the user in (via /auth/confirm or Supabase's PASSWORD_RECOVERY event); no session = no link.
  useEffect(() => {
    let active = true;
    const accept = (email?: string | null) => {
      if (!active) return;
      setAccountEmail(email ?? "");
      setPhase((p) => (p === "done" ? p : "ready"));
    };
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) accept(data.session.user.email);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) accept(session?.user.email);
    });
    // Give a link in the URL hash a moment to be exchanged before calling it invalid.
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (active && !data.session) setPhase((p) => (p === "checking" ? "invalid" : p));
    }, 1800);
    return () => {
      active = false;
      window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  // After success, continue to log in (the button skips the wait).
  useEffect(() => {
    if (phase !== "done") return;
    const timer = window.setTimeout(() => router.replace("/login?reset=done"), 2200);
    return () => window.clearTimeout(timer);
  }, [phase, router]);

  const strength = passwordStrength(password);
  const match = confirmState(password, confirm);

  const fail = (text: string, fields: typeof missing = {}) => {
    setMissing(fields);
    setErr((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
  };

  const submit = async () => {
    setErr(null);
    if (!password || !confirm) return fail("Enter and confirm your new password.", { password: !password, confirm: !confirm });
    if (password.length < 6) return fail("Use at least 6 characters for your new password.", { password: true });
    if (password !== confirm) return fail("Passwords don't match yet.", { confirm: true });
    setMissing({});
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) {
        const same = /different from the old|same password/i.test(error.message);
        return fail(same ? "Choose a password you haven't used for this account before." : error.message || "Unable to update your password.", { password: same });
      }
      // Hand the address to the login form in-tab (not in the URL) so they can sign in with the new password.
      const email = data.user?.email || accountEmail || emailHint;
      if (email) stashAuthEmail(email);
      await supabase.auth.signOut();
      setPhase("done");
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unable to update your password.");
    } finally {
      setLoading(false);
    }
  };

  if (phase === "invalid") {
    return (
      <AuthShell
        mode="login"
        loginHref={loginHref}
        signupHref={signupHref}
        title="Request a new reset link"
        subtitle="This page needs a valid link from a password-reset email. Links work once and expire after a short time."
        footer={
          <>
            Remembered it?{" "}
            <Link href={loginHref} className="font-bold text-[#aef07f] transition hover:text-white">
              Log in
            </Link>
          </>
        }
      >
        <ResendConfirmation initialEmail={emailHint || readAuthEmail() || ""} kind="reset" />
      </AuthShell>
    );
  }

  if (phase === "done") {
    return (
      <AuthShell mode="login" loginHref={loginHref} signupHref={signupHref} title="Password updated" subtitle="Use your new password to log in from now on.">
        <div className="grid gap-5">
          <div role="status" aria-live="polite" className="relative grid justify-items-center gap-3 overflow-hidden rounded-[1.25rem] border border-[#8fe05f]/25 bg-[radial-gradient(120%_90%_at_50%_0%,rgba(143,224,95,0.16),transparent_60%)] px-4 pb-6 pt-7 text-center">
            <span className="rx-pop-in grid h-16 w-16 place-items-center rounded-full bg-[#22c55e] text-white shadow-[0_14px_30px_rgba(34,197,94,0.4)]" aria-hidden>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
                <path d="m5 10.5 3.2 3.2L15 7" />
              </svg>
            </span>
            <p className="text-[1.05rem] font-extrabold text-white">You&apos;re all set</p>
            <p className="text-[0.85rem] font-semibold text-white/60">Taking you to log in…</p>
          </div>
          <button
            type="button"
            onClick={() => router.replace("/login?reset=done")}
            className="resources-cta-button inline-flex h-12 w-full items-center justify-center gap-2 rounded-[1rem] bg-[#8fe05f] px-6 text-base font-extrabold text-[#0b1914] shadow-[0_16px_34px_rgba(143,224,95,0.25)] transition hover:bg-[#9ae86a] sm:h-[3.25rem]"
          >
            Log in now
          </button>
        </div>
      </AuthShell>
    );
  }

  const checking = phase === "checking";
  return (
    <AuthShell
      mode="login"
      loginHref={loginHref}
      signupHref={signupHref}
      title="Choose a new password"
      subtitle="Pick something you haven't used here before. You'll use it to log in from now on."
      footer={
        <>
          Changed your mind?{" "}
          <Link href={loginHref} className="font-bold text-[#aef07f] transition hover:text-white">
            Back to log in
          </Link>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className={`auth-form-panel grid gap-4 rounded-[1.1rem] ${err ? "has-auth-error" : ""}`}
      >
        {/* Which account this changes, so nobody resets the wrong one. */}
        <div className="flex items-center gap-3 rounded-[1rem] border border-white/10 bg-white/[0.04] px-3.5 py-3" aria-live="polite">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#8fe05f]/15 text-[#8fe05f]" aria-hidden>
            {checking ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[1.1rem] w-[1.1rem]">
                <path d="M12 3 19 6v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6l7-3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-[0.72rem] font-bold uppercase tracking-[0.14em] text-white/50">{checking ? "Checking your reset link" : "Resetting password for"}</span>
            <span className="block truncate text-[0.95rem] font-extrabold text-white">{checking ? "One moment…" : accountEmail || "your account"}</span>
          </span>
        </div>

        <fieldset disabled={checking || loading} className="grid gap-4 disabled:opacity-60">
          <AuthField
            id="reset-password-new"
            label="New password"
            icon="lock"
            invalid={missing.password}
            trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((prev) => !prev)} />}
          >
            <input
              id="reset-password-new"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErr(null);
              }}
              type={showPassword ? "text" : "password"}
              placeholder="6+ characters"
              aria-invalid={Boolean(missing.password)}
              aria-describedby="reset-password-strength"
              className={`${authInputClass} pr-12`}
              autoComplete="new-password"
            />
          </AuthField>

          <AuthField
            id="reset-password-confirm"
            label="Confirm new password"
            icon="lock"
            invalid={missing.confirm}
            trailing={<PasswordToggle shown={showConfirm} onToggle={() => setShowConfirm((prev) => !prev)} />}
          >
            <input
              id="reset-password-confirm"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setErr(null);
              }}
              type={showConfirm ? "text" : "password"}
              placeholder="Repeat new password"
              aria-invalid={Boolean(missing.confirm)}
              aria-describedby="reset-confirm-state"
              className={`${authInputClass} pr-12`}
              autoComplete="new-password"
            />
          </AuthField>
        </fieldset>

        <div className="-mt-1 grid gap-1.5" aria-live="polite">
          <div id="reset-password-strength" className={`rx-strength rx-strength--${strength.tone || "empty"} flex items-center gap-3`}>
            <span className="grid flex-1 grid-cols-4 gap-1.5" aria-hidden>
              {[1, 2, 3, 4].map((step) => (
                <span key={step} className={`rx-strength-bar h-1.5 rounded-full ${strength.score >= step ? "is-on" : ""}`} />
              ))}
            </span>
            <span className="rx-strength-label min-w-[4.5rem] text-right text-xs font-bold">{strength.label ? (strength.score > 1 ? strength.label : "Too short") : ""}</span>
          </div>
          <p id="reset-confirm-state" className="min-h-[1.1rem] text-xs font-semibold">
            {strength.score === 1 && <span className="text-white/64">Use at least 6 characters.</span>}
            {strength.score !== 1 && match === "match" && <span className="rx-confirm-ok">✓ Passwords match</span>}
            {strength.score !== 1 && match === "mismatch" && <span className="rx-confirm-bad">Passwords don&apos;t match yet</span>}
          </p>
        </div>

        {err && <AuthFeedback key={err.n} tone="error" message={err.text} />}

        <AuthSubmit loading={loading} label="Update password" loadingLabel="Updating password..." />
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#ecf4ef]" />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
