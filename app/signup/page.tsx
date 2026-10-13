"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthFeedback } from "@/app/_components/AuthFeedback";
import { AuthField, AuthShell, AuthSubmit, CarriedEmailCheck, CarriedEmailNote, PasswordToggle, authInputClass } from "@/app/_components/AuthShell";
import { supabase } from "@/lib/supabaseClient";
import { stashAuthEmail, useCarriedEmail } from "@/lib/authEmailHandoff";
import { confirmState, passwordStrength } from "@/lib/passwordStrength";
import { CheckInbox } from "@/app/_components/ResendConfirmation";

type SignupMissingField = "fullName" | "email" | "password" | "confirm" | "terms";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatMissingList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function missingSignupMessage(fields: SignupMissingField[]) {
  if (fields.length === 1) {
    if (fields[0] === "fullName") return "Enter your full name to create your account.";
    if (fields[0] === "email") return "Enter your email to create your account.";
    if (fields[0] === "password") return "Enter a password to create your account.";
    if (fields[0] === "confirm") return "Confirm your password to create your account.";
  }

  const labels = fields.map((field) => {
    if (field === "fullName") return "full name";
    if (field === "confirm") return "confirm password";
    return field;
  });
  return `Enter ${formatMissingList(labels)} to create your account.`;
}

function missingFieldMap(fields: SignupMissingField[]) {
  return fields.reduce<Partial<Record<SignupMissingField, boolean>>>((acc, field) => {
    acc[field] = true;
    return acc;
  }, {});
}


function SignupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams?.get("next") ?? null;
  const loginHref = `/login${nextParam ? `?next=${encodeURIComponent(nextParam)}` : ""}`;
  const signupHref = `/signup${nextParam ? `?next=${encodeURIComponent(nextParam)}` : ""}`;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errPulse, setErrPulse] = useState(0);
  const [missingFields, setMissingFields] = useState<Partial<Record<SignupMissingField, boolean>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  // Set once the confirmation email is on its way; swaps the form for the "check your inbox" panel.
  const [sentTo, setSentTo] = useState<string | null>(null);

  const emailNorm = useMemo(() => email.trim().toLowerCase(), [email]);
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm);

  // Email handed over from the homepage form (or an older ?email= link), shown with a "carried over" note.
  const [carriedEmail, setCarriedEmail] = useCarriedEmail(searchParams?.get("email"), setEmail, "signup-name");
  const showCarried = Boolean(carriedEmail) && email === carriedEmail;

  function nudgeAuthWarning() {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }).vibrate?.([24, 34, 24]);
  }

  function showAuthError(message: string) {
    setErr(message);
    setErrPulse((current) => current + 1);
    nudgeAuthWarning();
  }

  function clearAuthFeedback() {
    if (err) setErr(null);
    setMissingFields({});
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive || !data.session) return;
      router.replace("/post-login");
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  const signUp = async () => {
    setErr(null);

    const name = fullName.trim();
    const missingRequired: SignupMissingField[] = [];
    if (!name) missingRequired.push("fullName");
    if (!emailNorm) missingRequired.push("email");
    if (!password) missingRequired.push("password");
    if (!confirm) missingRequired.push("confirm");

    if (missingRequired.length) {
      setMissingFields(missingFieldMap(missingRequired));
      showAuthError(missingSignupMessage(missingRequired));
      return;
    }
    if (!emailLooksValid) {
      setMissingFields({ email: true });
      showAuthError("Enter a valid email address to create your account.");
      return;
    }
    if (password.length < 6) {
      setMissingFields({ password: true });
      showAuthError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setMissingFields({ password: true, confirm: true });
      showAuthError("Passwords do not match.");
      return;
    }
    if (!acceptTerms) {
      setMissingFields({ terms: true });
      showAuthError("Please accept terms to continue.");
      return;
    }
    setMissingFields({});

    setLoading(true);
    try {
      // The server creates the account and sends the confirmation email through the app's own mailer.
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailNorm, password, name }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) {
        if (body.code === "weak_password") setMissingFields({ password: true });
        if (body.code === "invalid_email") setMissingFields({ email: true });
        showAuthError(body.error || "Unable to create account right now.");
        return;
      }
      // Kept for this tab so an expired-link page or the login screen can offer a one-tap resend.
      stashAuthEmail(emailNorm);
      setPassword("");
      setConfirm("");
      setSentTo(emailNorm);
    } catch (error) {
      showAuthError(errorMessage(error, "Unexpected error while creating your account."));
    } finally {
      setLoading(false);
    }
  };

  const strength = passwordStrength(password);
  const confirmMatch = confirmState(password, confirm);

  return (
    <AuthShell
      mode="signup"
      loginHref={loginHref}
      signupHref={signupHref}
      title={sentTo ? "Check your inbox" : "Create your account"}
      subtitle={sentTo ? "One last step: confirm your email to activate your account." : "Join with any email and start picking up brand gigs."}
      footer={
        <>
          Already have an account?{" "}
          <Link href={loginHref} className="font-bold text-[#aef07f] transition hover:text-white">
            Log in
          </Link>
        </>
      }
    >
      {sentTo ? (
        <CheckInbox
          email={sentTo}
          onChangeEmail={() => {
            setSentTo(null);
            setCarriedEmail(null);
            requestAnimationFrame(() => {
              const input = document.getElementById("signup-email") as HTMLInputElement | null;
              input?.focus();
              input?.select();
            });
          }}
        />
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void signUp();
          }}
          className={`auth-form-panel grid gap-4 rounded-[1.1rem] ${err ? "has-auth-error" : ""}`}
        >
          <AuthField id="signup-name" label="Full name" icon="user" invalid={missingFields.fullName}>
            <input
              id="signup-name"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                clearAuthFeedback();
              }}
              placeholder="Jane Creator"
              aria-invalid={Boolean(missingFields.fullName)}
              className={authInputClass}
              autoComplete="name"
            />
          </AuthField>

          <AuthField
            id="signup-email"
            label="Email address"
            icon="mail"
            invalid={missingFields.email}
            trailing={showCarried ? <CarriedEmailCheck /> : undefined}
            hint={showCarried ? <CarriedEmailNote id="signup-email-carried" inputId="signup-email" onChange={() => setCarriedEmail(null)} /> : undefined}
          >
            <input
              id="signup-email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearAuthFeedback();
              }}
              placeholder="you@example.com"
              aria-invalid={Boolean(missingFields.email)}
              aria-describedby={showCarried ? "signup-email-carried" : undefined}
              className={`${authInputClass} ${showCarried ? "pr-11!" : ""}`}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
            />
          </AuthField>

          <div className="grid gap-4 sm:grid-cols-2 sm:gap-3 lg:grid-cols-1 lg:gap-4 xl:grid-cols-2 xl:gap-3">
            <AuthField
              id="signup-password"
              label="Password"
              icon="lock"
              invalid={missingFields.password}
              trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((prev) => !prev)} />}
            >
              <input
                id="signup-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearAuthFeedback();
                }}
                placeholder="6+ characters"
                type={showPassword ? "text" : "password"}
                aria-invalid={Boolean(missingFields.password)}
                aria-describedby="signup-password-strength"
                className={`${authInputClass} pr-12`}
                autoComplete="new-password"
              />
            </AuthField>

            <AuthField
              id="signup-confirm"
              label="Confirm password"
              icon="lock"
              invalid={missingFields.confirm}
              trailing={<PasswordToggle shown={showConfirmPassword} onToggle={() => setShowConfirmPassword((prev) => !prev)} />}
            >
              <input
                id="signup-confirm"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  clearAuthFeedback();
                }}
                placeholder="Repeat password"
                type={showConfirmPassword ? "text" : "password"}
                aria-invalid={Boolean(missingFields.confirm)}
                aria-describedby="signup-confirm-state"
                className={`${authInputClass} pr-12`}
                autoComplete="new-password"
              />
            </AuthField>
          </div>

          <div className="-mt-1 grid gap-1.5" aria-live="polite">
            <div id="signup-password-strength" className={`rx-strength rx-strength--${strength.tone || "empty"} flex items-center gap-3`}>
              <span className="grid flex-1 grid-cols-4 gap-1.5" aria-hidden>
                {[1, 2, 3, 4].map((step) => (
                  <span key={step} className={`rx-strength-bar h-1.5 rounded-full ${strength.score >= step ? "is-on" : ""}`} />
                ))}
              </span>
              <span className="rx-strength-label min-w-[4.5rem] text-right text-xs font-bold">{strength.label ? (strength.score > 1 ? strength.label : "Too short") : ""}</span>
            </div>
            <p id="signup-confirm-state" className="min-h-[1.1rem] text-xs font-semibold">
              {strength.score === 1 && <span className="text-white/64">Use at least 6 characters.</span>}
              {strength.score !== 1 && confirmMatch === "match" && <span className="rx-confirm-ok">✓ Passwords match</span>}
              {strength.score !== 1 && confirmMatch === "mismatch" && <span className="rx-confirm-bad">Passwords don&apos;t match yet</span>}
            </p>
          </div>

          <label
            className={`auth-terms-row flex cursor-pointer items-start gap-3 rounded-[0.9rem] px-1 py-1 text-sm leading-6 text-white/80 ${
              missingFields.terms ? "has-auth-error" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => {
                setAcceptTerms(e.target.checked);
                clearAuthFeedback();
              }}
              aria-invalid={Boolean(missingFields.terms)}
              className="auth-field-checkbox mt-1 h-[1.1rem] w-[1.1rem] shrink-0 cursor-pointer rounded accent-[#58b52d]"
            />
            <span>I agree to the terms and privacy policy</span>
          </label>

          {err && <AuthFeedback key={`signup-error-${errPulse}`} tone="error" message={err} />}

          <AuthSubmit loading={loading} label="Create account" loadingLabel="Creating account..." />
        </form>
      )}
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#ecf4ef]" />}>
      <SignupPageInner />
    </Suspense>
  );
}
