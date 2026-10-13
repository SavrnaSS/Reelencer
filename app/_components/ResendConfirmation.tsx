"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthFeedback } from "@/app/_components/AuthFeedback";
import { AuthField, authInputClass } from "@/app/_components/AuthShell";
import { supabase } from "@/lib/supabaseClient";
import { AUTH_LINK_TTL } from "@/lib/authLinkTtl";

const COOLDOWN_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Asks the server to (re)send a confirmation link. Same answer for every address; only throttling/mail errors surface. */
export async function requestConfirmationEmail(email: string, kind: "confirm" | "reset" = "confirm"): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(kind === "reset" ? "/api/auth/password-reset" : "/api/auth/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error || "We couldn't send the email. Please try again." };
  } catch {
    return { ok: false, error: "You seem to be offline. Check your connection and try again." };
  }
}

/** Counts down from `seconds` once started; returns the remaining seconds and a restart function. */
export function useCooldown(initial = 0) {
  const [until, setUntil] = useState(() => (initial ? Date.now() + initial * 1000 : 0));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [until]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return [left, () => { setNow(Date.now()); setUntil(Date.now() + COOLDOWN_SECONDS * 1000); }] as const;
}

/** Webmail shortcut for common providers, so "check your inbox" is one tap away. */
export function inboxFor(email: string): { label: string; href: string } | null {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (["gmail.com", "googlemail.com"].includes(domain)) return { label: "Open Gmail", href: "https://mail.google.com/mail/u/0/#search/from%3Areelencer+in%3Aanywhere" };
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) return { label: "Open Outlook", href: "https://outlook.live.com/mail/0/" };
  if (/^(yahoo|ymail)\./.test(domain)) return { label: "Open Yahoo Mail", href: "https://mail.yahoo.com/" };
  if (["icloud.com", "me.com", "mac.com"].includes(domain)) return { label: "Open iCloud Mail", href: "https://www.icloud.com/mail" };
  if (["proton.me", "protonmail.com", "pm.me"].includes(domain)) return { label: "Open Proton Mail", href: "https://mail.proton.me/" };
  return null;
}

const primaryBtn =
  "resources-cta-button group inline-flex h-12 w-full items-center justify-center gap-2 rounded-[1rem] bg-[#8fe05f] px-6 text-base font-extrabold text-[#0b1914] shadow-[0_16px_34px_rgba(143,224,95,0.25)] transition hover:bg-[#9ae86a] disabled:cursor-not-allowed disabled:opacity-60 sm:h-[3.25rem]";
const secondaryBtn =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-[1rem] border border-white/14 bg-white/[0.04] px-5 text-[0.95rem] font-bold text-white transition hover:border-white/28 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-55 sm:h-[3.25rem]";

const STEPS = ["Signed up", "Confirm email", "Start earning"] as const;

/** Signed up → Confirm email → Start earning; `current` is the active step (3 = all done). */
export function SignupProgress({ current }: { current: number }) {
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Sign-up progress">
      {STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={label} className="grid gap-2" aria-current={active ? "step" : undefined}>
            <span className={`h-1.5 overflow-hidden rounded-full transition-colors duration-500 ${done ? "bg-[#8fe05f]" : active ? "bg-[#8fe05f]/25" : "bg-white/10"}`}>
              {active && <span className="rx-progress-fill block h-full w-1/2 rounded-full bg-[#8fe05f]" />}
            </span>
            <span className={`flex items-center gap-1.5 text-[0.7rem] font-bold leading-tight min-[400px]:text-[0.76rem] ${done ? "text-[#aef07f]" : active ? "text-white" : "text-white/45"}`}>
              {done && (
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0" aria-hidden>
                  <path d="m5 10.5 3.2 3.2L15 7" />
                </svg>
              )}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Small ring that empties as the resend cooldown runs out. */
function CooldownRing({ left }: { left: number }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden>
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.4" />
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - left / COOLDOWN_SECONDS)} className="transition-[stroke-dashoffset] duration-500 ease-linear" />
    </svg>
  );
}

/**
 * Shown after sign-up: progress, where the link went (editable), a webmail shortcut, resend with cooldown, and
 * tips. It also listens for the confirmation: clicking the link in another tab signs this tab in too (Supabase
 * syncs sessions across tabs), so the page moves on by itself.
 */
export function CheckInbox({ email, onChangeEmail }: { email: string; onChangeEmail: () => void }) {
  const router = useRouter();
  const [left, restart] = useCooldown(COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "error"; text: string; n: number } | null>(null);
  const inbox = inboxFor(email);

  useEffect(() => {
    let timer = 0;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session || (event !== "SIGNED_IN" && event !== "INITIAL_SESSION")) return;
      setConfirmed(true);
      timer = window.setTimeout(() => router.replace("/post-login"), 1200);
    });
    return () => {
      data.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, [router]);

  const resend = async () => {
    setSending(true);
    const result = await requestConfirmationEmail(email);
    setSending(false);
    setNote((prev) => ({ tone: result.ok ? "success" : "error", text: result.ok ? "Sent again. The newest link replaces the old one." : result.error, n: (prev?.n ?? 0) + 1 }));
    if (result.ok) restart();
  };

  const current = confirmed ? 2 : 1;

  return (
    <div className="grid gap-5 sm:gap-6">
      <SignupProgress current={current} />

      {/* Hero */}
      <div className="relative grid justify-items-center gap-3 overflow-hidden rounded-[1.25rem] border border-[#8fe05f]/25 bg-[radial-gradient(120%_90%_at_50%_0%,rgba(143,224,95,0.16),transparent_60%)] px-4 pb-5 pt-7 text-center sm:px-6">
        <div className="relative grid h-20 w-20 place-items-center" aria-hidden>
          {!confirmed && (
            <>
              <span className="rx-mail-ring absolute inset-0 rounded-full border border-[#8fe05f]/40" />
              <span className="rx-mail-ring absolute inset-0 rounded-full border border-[#8fe05f]/40 [animation-delay:1.2s]" />
            </>
          )}
          <span className={`relative grid h-16 w-16 place-items-center rounded-[1.25rem] shadow-[0_14px_30px_rgba(110,190,70,0.35)] transition-colors duration-500 ${confirmed ? "bg-[#22c55e] text-white" : "bg-[linear-gradient(160deg,#b4f08a,#86d957)] text-[#0b1914]"}`}>
            {confirmed ? (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="rx-pop-in h-8 w-8">
                <path d="m5 10.5 3.2 3.2L15 7" />
              </svg>
            ) : (
              <span className="relative block h-8 w-9 overflow-hidden">
                <span className="rx-mail-letter absolute left-1.5 right-1.5 top-0 h-5 rounded-[3px] bg-white shadow-sm">
                  <span className="mx-1.5 mt-1.5 block h-[3px] rounded bg-[#8fe05f]" />
                  <span className="mx-1.5 mt-1 block h-[3px] w-3 rounded bg-[#cfe9bf]" />
                </span>
                <svg viewBox="0 0 36 32" fill="none" className="absolute inset-0 h-full w-full">
                  <rect x="2" y="9" width="32" height="21" rx="4" fill="#0b1914" />
                  <path d="m3 11 15 11 15-11" stroke="#8fe05f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </span>
        </div>

        <div className="grid justify-items-center gap-2" role="status" aria-live="polite">
          <p className="text-[0.95rem] font-bold text-white">{confirmed ? "Email confirmed!" : "We sent a confirmation link to"}</p>
          {!confirmed && (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/12 bg-white/[0.06] py-1 pl-3.5 pr-1">
              <span className="min-w-0 truncate text-[0.95rem] font-extrabold text-[#aef07f]" title={email}>
                {email}
              </span>
              <button
                type="button"
                onClick={onChangeEmail}
                aria-label="Change email address"
                title="Use a different email"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fe05f]"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                  <path d="m12.5 4.5 3 3L7 16H4v-3l8.5-8.5Z" />
                </svg>
              </button>
            </span>
          )}
          <p className="max-w-[22rem] text-balance text-[0.82rem] font-semibold leading-relaxed text-white/60">
            <span className="relative mr-2 inline-flex h-2 w-2 align-middle" aria-hidden>
              {!confirmed && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8fe05f] opacity-60 motion-reduce:hidden" />}
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#8fe05f]" />
            </span>
            {confirmed ? "Taking you to your workspace…" : "Waiting for you to click the link. This page updates on its own."}
          </p>
        </div>
      </div>

      {!confirmed && (
        <>
          <div className={`grid gap-3 ${inbox ? "sm:grid-cols-2" : ""}`}>
            {inbox && (
              <a href={inbox.href} target="_blank" rel="noopener noreferrer" className={primaryBtn}>
                {inbox.label}
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden>
                  <path d="M7 13 13 7M8 7h5v5" />
                </svg>
              </a>
            )}
            <button type="button" onClick={resend} disabled={sending || left > 0} aria-busy={sending} className={inbox ? secondaryBtn : primaryBtn}>
              {sending ? (
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : left > 0 ? (
                <CooldownRing left={left} />
              ) : (
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                  <path d="M15.5 8A6 6 0 1 0 16 12M15.5 3.5V8H11" />
                </svg>
              )}
              {sending ? "Sending…" : left > 0 ? <span className="tabular-nums">Resend in {left}s</span> : "Resend email"}
            </button>
          </div>

          {note && <AuthFeedback key={note.n} tone={note.tone} message={note.text} />}

          <ul className="grid gap-2.5 min-[420px]:grid-cols-2">
            {[
              { title: "Can't find it?", body: "Check Spam or Promotions, or search “Reelencer”.", icon: "M3.5 6.5h13M5.5 6.5l.8 9a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.8-9M8 6.5V4.8A1.3 1.3 0 0 1 9.3 3.5h1.4A1.3 1.3 0 0 1 12 4.8v1.7" },
              { title: `Link expires in ${AUTH_LINK_TTL}`, body: "Request a new one here any time.", icon: "M10 17.2a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4ZM10 6.2V10l2.6 1.6" },
            ].map((tip) => (
              <li key={tip.title} className="flex items-start gap-3 rounded-[0.95rem] border border-white/10 bg-white/[0.03] p-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[0.6rem] bg-[#8fe05f]/15 text-[#8fe05f]" aria-hidden>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d={tip.icon} />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.84rem] font-bold text-white">{tip.title}</span>
                  <span className="block text-[0.78rem] leading-snug text-white/55">{tip.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Standalone "send me a new link" form (expired links, unconfirmed log-in attempts). */
export function ResendConfirmation({ initialEmail = "", compact = false, kind = "confirm" }: { initialEmail?: string; compact?: boolean; kind?: "confirm" | "reset" }) {
  const [email, setEmail] = useState(initialEmail);
  const [left, restart] = useCooldown();
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "error"; text: string; n: number } | null>(null);
  const trimmed = email.trim();

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!EMAIL_RE.test(trimmed)) {
      setNote((prev) => ({ tone: "error", text: "Enter the email you signed up with.", n: (prev?.n ?? 0) + 1 }));
      return;
    }
    setSending(true);
    const result = await requestConfirmationEmail(trimmed, kind);
    setSending(false);
    setNote((prev) => ({
      tone: result.ok ? "success" : "error",
      text: result.ok
        ? kind === "reset"
          ? `If ${trimmed} has a Reelencer account, a reset link is on its way.`
          : `If ${trimmed} has an account waiting for confirmation, a new link is on its way.`
        : result.error,
      n: (prev?.n ?? 0) + 1,
    }));
    if (result.ok) restart();
  };

  if (compact) {
    return (
      <div className="grid gap-2">
        <button type="button" onClick={() => void submit()} disabled={sending || left > 0} className={secondaryBtn}>
          {sending ? "Sending…" : left > 0 ? `Resend in ${left}s` : "Resend confirmation email"}
        </button>
        {note && <AuthFeedback key={note.n} tone={note.tone} message={note.text} />}
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="auth-form-panel grid gap-4 rounded-[1.1rem]">
      <AuthField id="resend-email" label="Email address" icon="mail">
        <input
          id="resend-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={authInputClass}
        />
      </AuthField>
      {note && <AuthFeedback key={note.n} tone={note.tone} message={note.text} />}
      <button type="submit" disabled={sending || left > 0} aria-busy={sending} className={primaryBtn}>
        {sending ? "Sending…" : left > 0 ? `Resend in ${left}s` : kind === "reset" ? "Send a new reset link" : "Send a new link"}
      </button>
    </form>
  );
}
