"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { AuthShell } from "@/app/_components/AuthShell";
import { ResendConfirmation, SignupProgress } from "@/app/_components/ResendConfirmation";
import { clearAuthEmail, readAuthEmail } from "@/lib/authEmailHandoff";
import { FIND_GIGS_HREF } from "@/lib/routes";
import { AUTH_LINK_TTL } from "@/lib/authLinkTtl";
import { supabase } from "@/lib/supabaseClient";

const OTP_TYPES: EmailOtpType[] = ["signup", "magiclink", "email", "invite", "email_change", "recovery"];
const REDIRECT_SECONDS = 3;

/** Only same-site paths are allowed as the post-confirmation destination. */
function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/post-login";
}

type State =
  | { phase: "verifying"; step: 0 | 1 | 2 }
  | { phase: "done"; name: string }
  | { phase: "failed"; reason: "expired" | "invalid" };

const CHECKS = ["Checking your secure link", "Activating your account", "Signing you in"] as const;
const RESET_CHECKS = ["Checking your reset link", "Verifying it's you", "Opening the new-password screen"] as const;

const shellLinks = { loginHref: "/login?next=/", signupHref: "/signup?next=/" } as const;

const primaryBtn =
  "resources-cta-button group inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-[1rem] bg-[#8fe05f] px-4 text-[0.95rem] font-extrabold sm:text-base text-[#0b1914] shadow-[0_16px_34px_rgba(143,224,95,0.25)] transition hover:bg-[#9ae86a] sm:h-[3.25rem]";
const secondaryBtn =
  "inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-[1rem] border border-white/14 bg-white/[0.04] px-4 text-[0.95rem] font-bold text-white transition hover:border-white/28 hover:bg-white/[0.08] sm:h-[3.25rem]";

/** Centered status card shared by every state: an icon badge, a message, and optional extras. */
function StatusCard({ tone, badge, children }: { tone: "pending" | "success" | "warning"; badge: ReactNode; children: ReactNode }) {
  const frame =
    tone === "warning"
      ? "border-[#ffb547]/30 bg-[radial-gradient(120%_90%_at_50%_0%,rgba(255,181,71,0.14),transparent_60%)]"
      : "border-[#8fe05f]/25 bg-[radial-gradient(120%_90%_at_50%_0%,rgba(143,224,95,0.16),transparent_60%)]";
  return (
    <div className={`relative grid justify-items-center gap-4 overflow-hidden rounded-[1.25rem] border px-4 pb-6 pt-7 text-center sm:px-6 ${frame}`}>
      <div className="relative grid h-20 w-20 place-items-center" aria-hidden>
        {badge}
      </div>
      {children}
    </div>
  );
}

function ConfirmInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<State>({ phase: "verifying", step: 0 });
  const [left, setLeft] = useState(REDIRECT_SECONDS);
  // Password-reset links share this page but skip the sign-up celebration and go straight to /reset-password.
  const [isReset, setIsReset] = useState(false);
  const nextRef = useRef("/post-login");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const tokenHash = searchParams?.get("token_hash");
    const type = searchParams?.get("type") as EmailOtpType | null;
    nextRef.current = safeNext(searchParams?.get("next") ?? null);
    // Tokens are single-use: take them out of the address bar right away.
    window.history.replaceState(window.history.state, "", "/auth/confirm");

    void (async () => {
      if (!tokenHash || !type || !OTP_TYPES.includes(type)) {
        setState({ phase: "failed", reason: "invalid" });
        return;
      }
      setIsReset(type === "recovery");
      setState({ phase: "verifying", step: 1 });
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) {
        setState({ phase: "failed", reason: /expired|invalid/i.test(error.message) ? "expired" : "invalid" });
        return;
      }
      setState({ phase: "verifying", step: 2 });
      if (type === "recovery") {
        router.replace(nextRef.current);
        return;
      }
      clearAuthEmail();
      const meta = data.user?.user_metadata ?? {};
      const name = String(meta.name ?? meta.full_name ?? "").trim().split(/\s+/)[0] ?? "";
      // A beat on the last check so the checklist reads as finished before the success state.
      window.setTimeout(() => setState({ phase: "done", name }), 450);
    })();
  }, [router, searchParams]);

  // Count down, then continue to the workspace (the button skips the wait). The tick only updates state;
  // navigating happens in its own effect, never inside a state updater (which React may run during render).
  useEffect(() => {
    if (state.phase !== "done") return;
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase === "done" && left === 0) router.replace(nextRef.current);
  }, [state.phase, left, router]);

  if (state.phase === "failed") {
    const expired = state.reason === "expired";
    return (
      <AuthShell
        mode={isReset ? "login" : "signup"}
        {...shellLinks}
        title={`This ${isReset ? "reset " : ""}link ${expired ? "has expired" : "didn't work"}`}
        subtitle="No problem, we'll send you a fresh one."
        footer={
          <>
            {isReset ? "Remembered it?" : "Already confirmed?"}{" "}
            <Link href="/login?next=/" className="font-bold text-[#aef07f] transition hover:text-white">
              Log in
            </Link>
          </>
        }
      >
        <div className="grid gap-5 sm:gap-6">
          {!isReset && <SignupProgress current={1} />}
          <StatusCard
            tone="warning"
            badge={
              <span className="rx-pop-in grid h-16 w-16 place-items-center rounded-[1.25rem] bg-[linear-gradient(160deg,#ffd48a,#ffb547)] text-[#3b2405] shadow-[0_14px_30px_rgba(255,181,71,0.32)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
                  {expired ? (
                    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2" />
                  ) : (
                    <path d="M10 14a4 4 0 0 0 5.7.3l3-3a4 4 0 0 0-5.7-5.6l-1 1M14 10a4 4 0 0 0-5.7-.3l-3 3a4 4 0 0 0 5.7 5.6l1-1M4 4l2 2M20 20l-2-2" />
                  )}
                </svg>
              </span>
            }
          >
            <div className="grid gap-1.5" role="status">
              <p className="text-[0.98rem] font-bold text-white">{expired ? `${isReset ? "Reset" : "Confirmation"} links last ${AUTH_LINK_TTL}` : "We couldn't read this link"}</p>
              <p className="mx-auto max-w-[24rem] text-balance text-[0.85rem] leading-relaxed text-white/60">
                {expired
                  ? "Each link also works only once, so an older email or a second click won't work. Request a new link below and use the newest email."
                  : "It may be incomplete (some email apps split long links) or from an older email. Request a new link below and use the newest email."}
              </p>
            </div>
          </StatusCard>
          <ResendConfirmation initialEmail={readAuthEmail() ?? ""} kind={isReset ? "reset" : "confirm"} />
        </div>
      </AuthShell>
    );
  }

  if (state.phase === "done") {
    return (
      <AuthShell mode="signup" {...shellLinks} title="Email confirmed" subtitle="Your account is active. Welcome to Reelencer!">
        <div className="grid gap-5 sm:gap-6">
          <SignupProgress current={3} />
          <StatusCard
            tone="success"
            badge={
              <>
                {/* Small burst of dots around the check. */}
                {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
                  <span key={deg} className="rx-burst absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full" style={{ ["--a" as string]: `${deg}deg`, background: i % 2 ? "#8fe05f" : "#ffd48a" }} />
                ))}
                <span className="rx-pop-in grid h-16 w-16 place-items-center rounded-full bg-[#22c55e] text-white shadow-[0_14px_30px_rgba(34,197,94,0.4)]">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
                    <path d="m5 10.5 3.2 3.2L15 7" />
                  </svg>
                </span>
              </>
            }
          >
            <div className="grid gap-1.5" role="status" aria-live="polite">
              <p className="text-[1.15rem] font-extrabold text-white">{state.name ? `You're in, ${state.name}!` : "You're in!"}</p>
              <p className="text-[0.85rem] font-semibold text-white/60">
                Opening your workspace in <span className="tabular-nums text-[#aef07f]">{left}s</span>…
              </p>
            </div>
          </StatusCard>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => router.replace(nextRef.current)} className={primaryBtn}>
              Go to my workspace
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden>
                <path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5" />
              </svg>
            </button>
            <Link href={FIND_GIGS_HREF} className={secondaryBtn}>
              Browse open gigs
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell mode={isReset ? "login" : "signup"} {...shellLinks} title={isReset ? "Checking your reset link" : "Confirming your email"} subtitle="Hang tight, this only takes a second.">
      <div className="grid gap-5 sm:gap-6">
        {!isReset && <SignupProgress current={1} />}
        <StatusCard
          tone="pending"
          badge={
            <>
              <span className="absolute inset-0 animate-spin rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,#8fe05f_300deg,transparent_360deg)] [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),#000_calc(100%-2px))] motion-reduce:animate-none" />
              <span className="grid h-16 w-16 place-items-center rounded-full bg-[#8fe05f]/15 text-[#8fe05f]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
                  <path d="M12 3 19 6v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6l7-3Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </span>
            </>
          }
        >
          <ul className="grid w-full max-w-[17rem] gap-2.5 text-left" role="status" aria-live="polite">
            {(isReset ? RESET_CHECKS : CHECKS).map((label, index) => {
              const done = index < state.step;
              const active = index === state.step;
              return (
                <li key={label} className={`flex items-center gap-2.5 text-[0.88rem] font-semibold transition-colors duration-300 ${done ? "text-white" : active ? "text-white" : "text-white/40"}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors duration-300 ${done ? "bg-[#22c55e] text-white" : active ? "border-2 border-[#8fe05f]/60" : "border-2 border-white/15"}`}>
                    {done ? (
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="rx-pop-in h-3 w-3" aria-hidden>
                        <path d="m5 10.5 3.2 3.2L15 7" />
                      </svg>
                    ) : active ? (
                      <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[#8fe05f]" />
                    ) : null}
                  </span>
                  {label}
                </li>
              );
            })}
          </ul>
        </StatusCard>
      </div>
    </AuthShell>
  );
}

export default function AuthConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#ecf4ef]" />}>
      <ConfirmInner />
    </Suspense>
  );
}
