"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ACCOUNT_REQUEST_LIMITS } from "@/lib/accountRequests";
import {
  ACCOUNT_LIMITS,
  accountPlatformFor,
  canReadBio,
  instructionLines,
  isPlatformProfileUrl,
  normalizeHandle,
  ownershipProven,
  parseAccountInstructions,
  payoutPhrase,
  validateAccountOwnership,
  type AccountOwnershipInput,
  type AccountSetupView,
} from "@/lib/accountSetup";
import { formatCompact } from "@/lib/socialAnalytics";
import { Button, Icon as UiIcon, Skeleton, buttonClassName, cx, formatRelative } from "./dashboardUi";
import PlatformGlyph from "./PlatformGlyph";

// Content Posting gigs: after applying, the creator creates or brings an account on the gig's platform and proves it's
// theirs by putting the application's code in the bio. No password is asked for: Instagram bios are read
// automatically (and re-read in the background until the code shows up); other platforms are checked by the team.

type Gig = { id: string; title: string; company: string; platform: string; payout?: string; payoutType?: string; requirements: string[] };
export type AccountSetupApplication = { id: string; status: string; proposal?: { accountSetup?: AccountSetupView } };

const ENDPOINT = "/api/gig-applications/account-setup";
/** Instagram's edit-profile page: opens the app on phones, so the creator lands straight on the bio. */
const INSTAGRAM_EDIT_PROFILE = "https://www.instagram.com/accounts/edit/";
const PROGRESS = ["Submitted", "Code in bio", "Team review", "Verified"];
/** "Just now" reads oddly mid-sentence ("Last checked Just now"). */
const relative = (value?: string) => {
  const text = formatRelative(value);
  return text === "Just now" ? "just now" : text;
};

const fieldClass =
  "h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-[16px] text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.04)] outline-none transition placeholder:text-[#9aa29c] focus:ring-2 sm:text-[14px]";
const fieldTone = (error?: string) => (error ? "border-[#e7a19a] focus:border-[#d03b3b] focus:ring-[#d03b3b]/15" : "border-[#d9ddd8] focus:border-[#7fa58c] focus:ring-[#2e7d4f]/20");

function Field({ label, optional, error, hint, htmlFor, children }: { label: string; optional?: boolean; error?: string; hint?: ReactNode; htmlFor: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2 text-[12.5px] font-semibold text-[#1a201c]">
        {label}
        {optional ? <span className="text-[11.5px] font-normal text-[#8a928c]">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 flex items-start gap-1 text-[12px] text-[#b42318]">
          <UiIcon.Close className="mt-0.5 h-3 w-3 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#7a827c]">{hint}</p>
      ) : null}
    </div>
  );
}

function CopyCode({ code, size = "md" }: { code: string; size?: "md" | "lg" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={cx(
        "inline-flex max-w-full items-center gap-2.5 rounded-lg border border-dashed border-[#9cc3a7] bg-white font-mono font-semibold tracking-[0.1em] text-[#1f5131] transition hover:bg-[#f4f9f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/30",
        size === "lg" ? "h-11 px-3.5 text-[17px]" : "h-9 px-3 text-[15px]"
      )}
      aria-label={`Copy code ${code}`}
    >
      {code}
      <span className={cx("rounded px-1.5 py-0.5 font-sans text-[11px] font-semibold tracking-normal", copied ? "bg-[#e3f1df] text-[#1f5131]" : "bg-[#eef1ed] text-[#2b5d4a]")} aria-live="polite">
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

/** The application's bio code. Stored on submitted setups; fetched for a new one so it can go in the bio up front. */
function useVerifyCode(applicationId: string, known: string | undefined, enabled: boolean) {
  const [fetched, setFetched] = useState<{ id: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const needed = enabled && !known && fetched?.id !== applicationId;
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${ENDPOINT}?applicationId=${encodeURIComponent(applicationId)}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.verifyCode) throw new Error(payload?.error || "Your code couldn't load.");
        if (!cancelled) setFetched({ id: applicationId, code: String(payload.verifyCode) });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Your code couldn't load.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needed, applicationId, attempt]);
  return {
    code: known ?? (fetched?.id === applicationId ? fetched.code : null),
    error,
    retry: () => {
      setError(null);
      setAttempt((value) => value + 1);
    },
  };
}


type ResolvedPreview =
  | { state: "not_found" | "unreadable" | "error"; handle: string; at: number; message?: string }
  | { state: "found"; handle: string; at: number; codeFound: boolean; isPrivate?: boolean; followers?: number; posts?: number };
type LivePreview = { state: "idle" | "manual" } | { state: "checking"; handle: string; previous?: ResolvedPreview } | ResolvedPreview;
const isResolved = (preview: LivePreview): preview is ResolvedPreview => preview.state !== "idle" && preview.state !== "manual" && preview.state !== "checking";
const LIVE_DEBOUNCE_MS = 700;
const LIVE_RECHECK_MS = 15_000;

/**
 * Live, read-only lookup of the account being set up: does it exist, is it public, is the code in the bio yet.
 * Runs as the username settles, re-checks every 15s while the code is still missing, and straight away when the
 * creator comes back from the Instagram app. Nothing is saved until they press Verify.
 */
function useLivePreview(applicationId: string, handle: string | null, enabled: boolean) {
  const [preview, setPreview] = useState<LivePreview>({ state: "idle" });
  const [tick, setTick] = useState(0);
  const target = enabled && handle ? handle : null;
  const settled = preview.state === "found" && preview.codeFound;

  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreview((current) => ({ state: "checking", handle: target, previous: isResolved(current) && current.handle === target ? current : undefined }));
      try {
        const response = await fetch(`${ENDPOINT}?applicationId=${encodeURIComponent(applicationId)}&handle=${encodeURIComponent(target)}`, { signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(payload?.error || "Couldn't look the account up.");
        const at = Date.now();
        if (payload?.state === "manual") setPreview({ state: "manual" });
        else if (payload?.state === "found") setPreview({ state: "found", handle: target, at, codeFound: !!payload.codeFound, isPrivate: payload.isPrivate, followers: payload.followers, posts: payload.posts });
        else setPreview({ state: payload?.state === "not_found" ? "not_found" : "unreadable", handle: target, at });
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreview({ state: "error", handle: target, at: Date.now(), message: error instanceof Error ? error.message : undefined });
      }
    }, tick ? 0 : LIVE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [applicationId, target, tick]);

  // Keep watching the bio until the code shows up: on a timer while visible, and on return to the tab.
  useEffect(() => {
    if (!target || settled || preview.state === "manual" || preview.state === "checking" || preview.state === "idle") return;
    const again = () => {
      if (!document.hidden && navigator.onLine) setTick((value) => value + 1);
    };
    const timer = window.setTimeout(again, LIVE_RECHECK_MS);
    const onVisible = () => {
      if (!document.hidden) again();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", again);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", again);
    };
  }, [target, settled, preview.state]);

  const current: LivePreview = !target ? { state: "idle" } : preview.state === "manual" ? preview : "handle" in preview && preview.handle === target ? preview : { state: "checking", handle: target };
  return { preview: current, checkNow: () => setTick((value) => value + 1) };
}

/** Live status of the account under the username field. */
function LiveAccountStatus({ preview, code, platformLabel, onCheck }: { preview: LivePreview; code: string | null; platformLabel: string; onCheck: () => void }) {
  if (!("handle" in preview)) return null;
  const shown: ResolvedPreview | undefined = preview.state === "checking" ? preview.previous : preview;
  const looking = preview.state === "checking";
  const tone =
    !shown ? "neutral"
    : shown.state === "found" ? (shown.codeFound ? "good" : shown.isPrivate ? "warn" : "wait")
    : shown.state === "not_found" ? "bad" : "neutral";
  const facts = shown?.state === "found"
    ? [
        shown.followers !== undefined ? `${formatCompact(shown.followers)} ${shown.followers === 1 ? "follower" : "followers"}` : null,
        shown.posts !== undefined ? `${formatCompact(shown.posts)} ${shown.posts === 1 ? "post" : "posts"}` : null,
        shown.isPrivate === undefined ? null : shown.isPrivate ? "Private" : "Public",
      ].filter(Boolean)
    : [];
  const headline = !shown
    ? `Looking up @${preview.handle} on ${platformLabel}…`
    : shown.state === "found"
      ? shown.codeFound ? "Code found in the bio. You're ready to verify." : shown.isPrivate ? "The account is private, so the bio can't be read." : `${code ?? "Your code"} isn't in the bio yet.`
      : shown.state === "not_found" ? `No ${platformLabel} account called @${preview.handle} yet.`
      : shown.state === "unreadable" ? `${platformLabel} didn't answer. Trying again shortly.`
      : shown.message || "Couldn't look the account up.";
  const hint = shown?.state === "found" && !shown.codeFound
    ? shown.isPrivate ? "Switch it to public for a moment. We'll check again on our own." : "Paste it in the bio and save. We'll spot it on our own."
    : shown?.state === "not_found" ? "Check the spelling, or finish creating the account first." : null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "mt-2 rounded-lg px-3 py-2.5 transition-colors",
        tone === "good" ? "bg-[#eaf5e6]" : tone === "wait" || tone === "warn" ? "bg-[#fdf6e6]" : tone === "bad" ? "bg-[#fdf0ee]" : "bg-[#f4f6f3]"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cx(
            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full",
            tone === "good" ? "bg-[#2e7d4f] text-white" : tone === "bad" ? "bg-[#f6d5d0] text-[#8e2b20]" : tone === "neutral" ? "bg-[#e3e7e1] text-[#4b544e]" : "bg-[#f5e3b5] text-[#6b4a05]"
          )}
        >
          {tone === "good" ? <UiIcon.Check className="h-3 w-3" /> : tone === "bad" ? <UiIcon.Close className="h-2.5 w-2.5" /> : looking || !shown ? <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cx("text-[12.5px] font-semibold leading-5", tone === "good" ? "text-[#1f5131]" : tone === "bad" ? "text-[#8e2b20]" : tone === "neutral" ? "text-[#3b443e]" : "text-[#6b4a05]")}>{headline}</p>
          {facts.length ? <p className="text-[11.5px] tabular-nums text-[#616a64]">@{preview.handle} · {facts.join(" · ")}</p> : null}
          {hint ? <p className="mt-0.5 text-[11.5px] leading-[1.1rem] text-[#616a64]">{hint}</p> : null}
        </div>
        {shown && tone !== "good" ? (
          <button type="button" onClick={onCheck} disabled={looking} className="shrink-0 rounded-md px-1.5 py-1 text-[11.5px] font-semibold text-[#2b5d4a] underline-offset-2 hover:underline disabled:text-[#9aa29c] disabled:no-underline">
            {looking ? "Checking…" : "Check now"}
          </button>
        ) : null}
      </div>
      {shown && tone !== "good" && tone !== "bad" && !looking ? (
        <p className="mt-1.5 flex items-center gap-1.5 pl-[30px] text-[11px] text-[#7a827c]">
          <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8dbf98] opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#2e7d4f]" />
          </span>
          Live: checking again every 15 seconds
        </p>
      ) : null}
    </div>
  );
}

function CodeSlot({ code, error, onRetry, size }: { code: string | null; error: string | null; onRetry: () => void; size?: "md" | "lg" }) {
  if (code) return <CopyCode code={code} size={size} />;
  if (error)
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-[12px] text-[#8e1f1a]">
        {error}
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </span>
    );
  return <Skeleton className={size === "lg" ? "h-11 w-40" : "h-9 w-36"} />;
}

function Progress({ step }: { step: number }) {
  return (
    <ol className="flex items-start" aria-label="Verification progress">
      {PROGRESS.map((label, index) => {
        const done = index < step;
        const current = index === step;
        return (
          <li key={label} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
            {/* Connector to the previous step */}
            {index > 0 ? <span className={cx("absolute right-1/2 top-[11px] h-0.5 w-full", done || current ? "bg-[#2e7d4f]" : "bg-[#e3e5e1]")} aria-hidden="true" /> : null}
            <span
              className={cx(
                "relative z-[1] flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors",
                done ? "bg-[#2e7d4f] text-white" : current ? "bg-white text-[#1f5131] ring-2 ring-[#2e7d4f]" : "bg-[#f1f3f0] text-[#9aa29c] ring-1 ring-[#e3e5e1]"
              )}
              aria-hidden="true"
            >
              {done ? <UiIcon.Check className="h-3 w-3" /> : index + 1}
            </span>
            <span className={cx("max-w-full truncate px-0.5 text-[11px]", done || current ? "font-semibold text-[#3b443e]" : "text-[#9aa29c]")} aria-current={current ? "step" : undefined}>
              {label}
              <span className="sr-only">{done ? " (done)" : current ? " (current)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function AccountSetupPanel({
  gig,
  application,
  onUpdated,
  onOpenStats,
}: {
  gig: Gig;
  application: AccountSetupApplication;
  /** Called with the server's copy of the application after a submission or a bio check. */
  onUpdated: (application: AccountSetupApplication & Record<string, unknown>) => void;
  /** Once verified the account is linked: jump to its analytics. */
  onOpenStats?: () => void;
}) {
  const uid = useId();
  const platform = useMemo(() => accountPlatformFor(gig.platform), [gig.platform]);
  const readable = canReadBio(platform);
  const adminSteps = useMemo(() => instructionLines(parseAccountInstructions(gig.requirements)), [gig.requirements]);
  const setup = application.proposal?.accountSetup;
  const pay = payoutPhrase(gig.payout, gig.payoutType);
  const verified = setup?.status === "Verified" || application.status === "Accepted";
  const changesRequested = setup?.status === "ChangesRequested";
  const owned = ownershipProven(setup);

  const [editing, setEditing] = useState(false);
  const formOpen = !verified && (!setup || changesRequested || editing);
  const { code, error: codeError, retry: retryCode } = useVerifyCode(application.id, setup?.verifyCode, !verified);
  const [values, setValues] = useState<Required<AccountOwnershipInput>>(() => ({
    handle: setup?.handle ?? "",
    profileUrl: setup?.profileUrl ?? "",
    notes: setup?.notes ?? "",
  }));
  // The profile link follows the username until the creator edits it themselves.
  const [urlTouched, setUrlTouched] = useState(!!setup?.profileUrl);
  const [touched, setTouched] = useState<Partial<Record<keyof AccountOwnershipInput, boolean>>>({});
  const [confirmed, setConfirmed] = useState(!!setup);
  // The profile link is derived from the username; its field only opens when the creator wants to change it.
  const [linkOpen, setLinkOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(!!setup?.notes);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);

  /* Bio checks: manual "Check again", plus a quiet background re-check while the code hasn't shown up. */
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const updatedRef = useRef(onUpdated);
  useEffect(() => {
    updatedRef.current = onUpdated;
  }, [onUpdated]);
  const recheck = useCallback(
    async (silent = false) => {
      if (!silent) {
        setChecking(true);
        setCheckMessage(null);
      }
      try {
        const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", applicationId: application.id }) });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Couldn't check right now.");
        updatedRef.current(payload);
        const found = payload?.proposal?.accountSetup?.ownership === "found";
        if (!silent || found) setCheckMessage(found ? "Code found. Your account is now with the team." : "Not there yet. Bio changes can take a minute to appear.");
      } catch (e) {
        // Background checks can hit the cooldown when another tab just checked; only manual checks report it.
        if (!silent) setCheckMessage(e instanceof Error ? e.message : "Couldn't check right now.");
      } finally {
        if (!silent) setChecking(false);
      }
    },
    [application.id]
  );
  const autoCheck = !verified && !formOpen && setup?.status === "Submitted" && readable && !owned;
  const lastChecked = setup?.checkedAt;
  useEffect(() => {
    if (!autoCheck) return;
    const cooldown = (ACCOUNT_REQUEST_LIMITS.recheckSeconds + 5) * 1000;
    const tick = () => {
      if (!document.hidden && navigator.onLine) void recheck(true);
    };
    // Coming back to the page after editing the bio: check straight away if the last read is old enough.
    const sinceLast = lastChecked ? Date.now() - Date.parse(lastChecked) : Infinity;
    const first = window.setTimeout(tick, Math.max(1500, cooldown - sinceLast));
    const timer = window.setInterval(tick, cooldown);
    const onVisible = () => {
      if (!document.hidden && (!lastChecked || Date.now() - Date.parse(lastChecked) > cooldown)) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [autoCheck, lastChecked, recheck]);

  const errors = validateAccountOwnership(values, platform);
  const visibleError = (key: keyof AccountOwnershipInput) => (touched[key] ? errors[key] : undefined);
  const ready = Object.keys(errors).length === 0 && confirmed && !!code;
  // Live lookup of the account while the form is open: steps tick off as the account and the code appear.
  const liveHandle = formOpen && readable && !!code && !!values.handle && !errors.handle ? normalizeHandle(values.handle, platform) : null;
  const { preview: live, checkNow } = useLivePreview(application.id, liveHandle, formOpen && readable);
  const accountFound = live.state === "found";
  const codeLive = live.state === "found" && live.codeFound;

  const set = (key: keyof AccountOwnershipInput, raw: string) =>
    setValues((prev) => {
      // The field already shows an "@" prefix, so a typed or pasted "@" is dropped straight away.
      const value = key === "handle" ? raw.replace(/^\s*@+/, "") : raw;
      const next = { ...prev, [key]: value };
      if (key === "handle" && !urlTouched) {
        const handle = normalizeHandle(value, platform);
        next.profileUrl = handle && platform.handleRule.test(handle) ? platform.profileUrl(handle) : "";
      }
      return next;
    });
  const blur = (key: keyof AccountOwnershipInput) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    // Tidy pasted values: "@Name" or a full profile link become the bare handle.
    if (key === "handle" && values.handle) setValues((prev) => ({ ...prev, handle: normalizeHandle(prev.handle, platform) }));
  };

  const submit = async () => {
    setTouched({ handle: true, profileUrl: true, notes: true });
    if (!ready || submitting) return;
    setSubmitting(true);
    setServerError(null);
    setCheckMessage(null);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: application.id, handle: normalizeHandle(values.handle, platform), profileUrl: values.profileUrl, notes: values.notes }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Your account couldn't be sent. Try again.");
      setEditing(false);
      setJustSent(true);
      onUpdated(payload);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Your account couldn't be sent. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- Verified ---------------- */
  if (verified) {
    return (
      <section aria-label={`${platform.label} account`} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#b9d5c0] bg-[#f1f8ef] p-3.5 sm:flex-nowrap sm:p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#2e7d4f] ring-1 ring-[#b9d5c0]">
          <PlatformGlyph platform={platform} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px] font-semibold text-[#1a201c]">
            {platform.label} account verified
            <UiIcon.Check className="h-4 w-4 text-[#2e7d4f]" />
          </div>
          <p className="text-[12.5px] leading-5 text-[#3b443e]">
            {setup ? (
              <>
                <a href={setup.profileUrl} target="_blank" rel="noreferrer noopener" className="font-semibold text-[#2b5d4a] underline-offset-2 hover:underline">
                  @{setup.handle}
                </a>{" "}
                · post the gig&apos;s reels here. {pay ? `You earn ${pay}, paid to your wallet.` : "Approved posts are paid to your wallet."}
                {setup.verifyCode ? <span className="text-[#616a64]"> You can remove {setup.verifyCode} from the bio now.</span> : null}
              </>
            ) : (
              `Post the gig's reels on this account. ${pay ? `You earn ${pay}, paid to your wallet.` : "Approved posts are paid to your wallet."}`
            )}
          </p>
        </div>
        {onOpenStats ? (
          <Button size="sm" variant="primary" onClick={onOpenStats} className="w-full shrink-0 min-[460px]:w-auto">
            View stats
          </Button>
        ) : null}
      </section>
    );
  }

  /* ---------------- Submitted, waiting for screening ---------------- */
  if (!formOpen && setup) {
    const ownership = setup.ownership ?? (readable ? "missing" : "manual");
    const shownCode = code ?? setup.verifyCode ?? "your code";
    const status = owned
      ? {
          tone: "success" as const,
          pill: "Ownership confirmed",
          title: "Code found in your bio",
          detail: `The team is now reviewing @${setup.handle} against the brief. You'll get an email as soon as they decide.`,
        }
      : ownership === "manual"
        ? {
            tone: "info" as const,
            pill: "With the team",
            title: "The team will confirm your code",
            detail: `Keep ${shownCode} in your ${platform.label} bio. The reviewer looks for it when they open your profile.`,
          }
        : ownership === "unreadable"
          ? {
              tone: "neutral" as const,
              pill: "Retrying",
              title: "We couldn't read your bio",
              detail: setup.ownershipDetail ?? `${platform.label} didn't respond on the last check.`,
            }
          : setup.isPrivate
            ? {
                tone: "warning" as const,
                pill: "Action needed",
                title: "Your account is private",
                detail: `We can't see the bio of a private account. Switch @${setup.handle} to public for a moment, then check again.`,
              }
            : {
                tone: "warning" as const,
                pill: "Action needed",
                title: "Add your code to the bio",
                detail: `Paste ${shownCode} anywhere in the @${setup.handle} bio and save. Changes can take a minute to show up.`,
              };
    const toneClass = {
      success: { panel: "border-[#cfe3d4] bg-[#f4f9f2]", icon: "bg-[#2e7d4f] text-white", pill: "bg-[#e3f1df] text-[#1f5131]" },
      warning: { panel: "border-[#ecdcb4] bg-[#fdf9ef]", icon: "bg-[#f5e3b5] text-[#6b4a05]", pill: "bg-[#fdf0d2] text-[#6b4a05]" },
      info: { panel: "border-[#d7e4f3] bg-[#f5f9fd]", icon: "bg-[#e0ecf8] text-[#1f4a73]", pill: "bg-[#e0ecf8] text-[#1f4a73]" },
      neutral: { panel: "border-[#e3e5e1] bg-[#fafbf9]", icon: "bg-[#eef0ed] text-[#4b544e]", pill: "bg-[#eef0ed] text-[#4b544e]" },
    }[status.tone];
    const stats = [
      setup.followers !== undefined ? `${formatCompact(setup.followers)} ${setup.followers === 1 ? "follower" : "followers"}` : null,
      setup.posts !== undefined ? `${formatCompact(setup.posts)} ${setup.posts === 1 ? "post" : "posts"}` : null,
    ].filter(Boolean);
    const editHref = platform.id === "instagram" ? INSTAGRAM_EDIT_PROFILE : setup.profileUrl || undefined;
    const actions = [
      {
        title: "Copy your code",
        body: <CodeSlot code={code} error={codeError} onRetry={retryCode} />,
      },
      {
        title: `Paste it in your ${platform.label} bio`,
        body: editHref ? (
          <a href={editHref} target="_blank" rel="noreferrer noopener" className={buttonClassName("secondary", "md", "gap-1.5")}>
            {platform.id === "instagram" ? "Open Instagram" : "Open profile"}
            <UiIcon.External className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="text-[12px] text-[#616a64]">Edit the bio in the {platform.label} app.</span>
        ),
      },
      readable
        ? {
            title: "We confirm it automatically",
            body: (
              <Button size="md" variant="primary" onClick={() => void recheck()} disabled={checking}>
                {checking ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" /> : null}
                {checking ? "Checking…" : "Check now"}
              </Button>
            ),
          }
        : { title: "The team confirms it", body: <span className="text-[12px] text-[#616a64]">No need to do anything else.</span> },
    ];
    return (
      <section aria-labelledby={`${uid}-title`} className="@container overflow-hidden rounded-2xl border border-[#dfe3de] bg-white shadow-[0_1px_2px_rgba(26,32,28,0.04)]">
        {justSent ? (
          <div role="status" className={cx("flex items-center gap-2 border-b px-4 py-2.5 text-[12.5px] font-semibold sm:px-5", owned ? "border-[#cfe3d4] bg-[#f1f8ef] text-[#1f5131]" : "border-[#d7e4f3] bg-[#eef4fb] text-[#1f4a73]")}>
            <UiIcon.Check className="h-4 w-4 shrink-0" />
            {owned ? "Account submitted and verified. It's now with the team." : readable ? "Account submitted. Add your code to the bio to finish." : "Account submitted. The team will confirm your code."}
          </div>
        ) : null}

        {/* Header */}
        <div className="flex flex-col gap-3 p-4 @md:flex-row @md:items-start @md:p-5">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f1f3f0] text-[#1a201c] ring-1 ring-[#e3e5e1]">
              <PlatformGlyph platform={platform} />
              {owned ? (
                <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#2e7d4f] text-white ring-2 ring-white" aria-hidden="true">
                  <UiIcon.Check className="h-2.5 w-2.5" />
                </span>
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 id={`${uid}-title`} className="min-w-0 truncate text-[15px] font-semibold text-[#1a201c]">
                  @{setup.handle}
                </h3>
                <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", toneClass.pill)}>{status.pill}</span>
              </div>
              <p className="mt-0.5 text-[12.5px] leading-5 text-[#616a64]">
                {owned
                  ? `Your ${platform.label} account is in screening. Once it's approved, you'll post the gig's reels on it.`
                  : `Your ${platform.label} account for ${gig.company}. Verify it's yours to move on to screening.`}
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setEditing(true)} className="w-full @md:w-auto">
            Edit details
          </Button>
        </div>

        <div className="space-y-4 px-4 pb-4 @md:px-5 @md:pb-5">
          <Progress step={owned ? 2 : 1} />

          {/* Verification */}
          <div className={cx("overflow-hidden rounded-xl border", toneClass.panel)}>
            <div className="flex items-start gap-3 p-3.5 @md:p-4">
              <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneClass.icon)} aria-hidden="true">
                {owned ? <UiIcon.Check className="h-4 w-4" /> : <UiIcon.Shield className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-[13.5px] font-semibold text-[#1a201c]">{status.title}</p>
                  {setup.checkedAt && ownership !== "manual" ? <span className="text-[11px] text-[#7a827c]">Last checked {relative(setup.checkedAt)}</span> : null}
                </div>
                <p className="mt-0.5 text-[12.5px] leading-5 text-[#4b544e]">{status.detail}</p>
              </div>
            </div>

            {!owned ? (
              <ol className="grid border-t border-black/[0.06] bg-white/70 @2xl:grid-cols-3">
                {actions.map((action, index) => (
                  <li key={action.title} className={cx("flex min-w-0 flex-col gap-2.5 p-3.5 @md:p-4", index > 0 && "border-t border-black/[0.06] @2xl:border-l @2xl:border-t-0")}>
                    <p className="flex items-center gap-2 text-[12px] font-semibold text-[#3b443e]">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1f2b24] text-[10.5px] font-bold text-white" aria-hidden="true">
                        {index + 1}
                      </span>
                      {action.title}
                    </p>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">{action.body}</div>
                  </li>
                ))}
              </ol>
            ) : null}

            {autoCheck || checkMessage ? (
              <div className="flex flex-col gap-1 border-t border-black/[0.06] px-3.5 py-2.5 text-[11.5px] @md:flex-row @md:items-center @md:justify-between @md:px-4">
                {autoCheck ? (
                  <span className="flex items-center gap-1.5 text-[#616a64]">
                    <span className="relative flex h-2 w-2" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8dbf98] opacity-60 motion-reduce:hidden" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2e7d4f]" />
                    </span>
                    Checking every minute while this page is open
                  </span>
                ) : (
                  <span />
                )}
                {checkMessage ? (
                  <span role="status" className="font-medium text-[#3b443e]">
                    {checkMessage}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Summary */}
          <div className="flex flex-col gap-2 border-t border-[#ebedea] pt-3 text-[12px] text-[#616a64] @lg:flex-row @lg:items-center @lg:justify-between">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {setup.profileUrl ? (
                <a href={setup.profileUrl} target="_blank" rel="noreferrer noopener" className="inline-flex min-w-0 items-center gap-1 font-semibold text-[#2b5d4a] underline-offset-2 hover:underline">
                  <span className="truncate">View profile</span>
                  <UiIcon.External className="h-3 w-3 shrink-0" />
                </a>
              ) : null}
              {stats.length ? (
                <>
                  <span aria-hidden="true" className="text-[#c5cbc6]">·</span>
                  <span className="tabular-nums">{stats.join(" · ")}</span>
                </>
              ) : null}
              <span aria-hidden="true" className="text-[#c5cbc6]">·</span>
              <span>
                Submitted {relative(setup.submittedAt)}
                {setup.revision > 1 ? ` (update ${setup.revision - 1})` : ""}
              </span>
            </p>
            <p className="flex items-center gap-1.5 text-[11.5px] text-[#7a827c]">
              <UiIcon.Shield className="h-3.5 w-3.5 shrink-0 text-[#2e7d4f]" />
              We never ask for your password.
            </p>
          </div>
        </div>
      </section>
    );
  }

  /* ---------------- Form (first time, after a change request, or editing) ---------------- */
  // Platform defaults stay one tap away; the gig's own instructions are shown up front because they differ per gig.
  const checklist = platform.steps.slice(0, -1);
  const ids = { handle: `${uid}-handle`, profileUrl: `${uid}-url`, notes: `${uid}-notes` };
  const urlLooksRight = !!values.profileUrl && isPlatformProfileUrl(values.profileUrl, platform);
  const showLinkField = linkOpen || !!visibleError("profileUrl") || (!!values.handle && !values.profileUrl);
  const handleOk = !!values.handle && !errors.handle;
  const steps: { title: string; hint?: string; done?: boolean; body: ReactNode }[] = [
    {
      title: `Create or choose your ${platform.label} account`,
      done: accountFound,
      hint: platform.id === "instagram" ? "Start a new one or use one you already run. It needs to be public and set to Creator." : "Start a new one or use one you already run. It needs to be public.",
      body: (
        <div className="space-y-2">
          {adminSteps.length ? (
            <ul className="space-y-1.5 rounded-lg bg-[#f7f8f6] p-3">
              <li className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">From {gig.company}</li>
              {adminSteps.map((step) => (
                <li key={step} className="flex gap-2 text-[12.5px] leading-5 text-[#3b443e]">
                  <UiIcon.Check className="mt-1 h-3 w-3 shrink-0 text-[#2e7d4f]" />
                  {step}
                </li>
              ))}
            </ul>
          ) : null}
          <details className="group text-[12.5px]">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-semibold text-[#2b5d4a] hover:underline [&::-webkit-details-marker]:hidden">
              How to get it ready
              <UiIcon.ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
            </summary>
            <ul className="mt-2 space-y-1.5">
              {checklist.map((step) => (
                <li key={step} className="flex gap-2 leading-5 text-[#4b544e]">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#9aa29c]" aria-hidden="true" />
                  {step}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ),
    },
    {
      title: "Add this code to the bio",
      done: codeLive,
      hint: readable ? "Paste it anywhere in the bio and save. We'll spot it on our own." : "Paste it anywhere in the bio and save.",
      body: (
        <div className="flex flex-wrap items-center gap-2">
          <CodeSlot code={code} error={codeError} onRetry={retryCode} size="lg" />
          {platform.id === "instagram" ? (
            <a href={INSTAGRAM_EDIT_PROFILE} target="_blank" rel="noreferrer noopener" className={buttonClassName("secondary", "lg", "gap-1.5")}>
              Open Instagram
              <UiIcon.External className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      ),
    },
    {
      title: "Enter its username",
      done: handleOk && !errors.profileUrl,
      body: (
        <div className="space-y-3">
          <div>
            <label htmlFor={ids.handle} className="sr-only">
              {platform.label} username
            </label>
            <div className={cx("flex items-center overflow-hidden rounded-lg border bg-white shadow-[0_1px_2px_rgba(26,32,28,0.04)] focus-within:ring-2", fieldTone(visibleError("handle")))}>
              <span className="pl-3 text-[15px] text-[#8a928c]" aria-hidden="true">
                @
              </span>
              <input
                id={ids.handle}
                value={values.handle}
                onChange={(event) => set("handle", event.target.value)}
                onBlur={() => blur("handle")}
                placeholder="your.username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={!!visibleError("handle")}
                aria-describedby={visibleError("handle") ? `${ids.handle}-error` : `${ids.handle}-link`}
                className="h-11 min-w-0 flex-1 bg-transparent pl-0.5 pr-3 text-[16px] text-[#1a201c] outline-none placeholder:text-[#9aa29c] sm:text-[14px]"
              />
              {handleOk ? <UiIcon.Check className="mr-3 h-4 w-4 shrink-0 text-[#2e7d4f]" /> : null}
            </div>
            {visibleError("handle") ? (
              <p id={`${ids.handle}-error`} className="mt-1.5 text-[12px] text-[#b42318]">
                {visibleError("handle")}
              </p>
            ) : (
              <LiveAccountStatus preview={live} code={code} platformLabel={platform.label} onCheck={checkNow} />
            )}
          </div>

          {showLinkField ? (
            <Field label="Profile link" htmlFor={ids.profileUrl} error={visibleError("profileUrl")} hint="Copy it from the profile's Share option.">
              <input
                id={ids.profileUrl}
                type="url"
                inputMode="url"
                value={values.profileUrl}
                onChange={(event) => {
                  setUrlTouched(true);
                  set("profileUrl", event.target.value);
                }}
                onBlur={() => blur("profileUrl")}
                placeholder={platform.profileUrl("your.username") || "https://"}
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={!!visibleError("profileUrl")}
                aria-describedby={visibleError("profileUrl") ? `${ids.profileUrl}-error` : undefined}
                className={cx(fieldClass, fieldTone(visibleError("profileUrl")))}
              />
            </Field>
          ) : urlLooksRight ? (
            <p id={`${ids.handle}-link`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#616a64]">
              <a href={values.profileUrl} target="_blank" rel="noreferrer noopener" className="inline-flex min-w-0 items-center gap-1 font-medium text-[#2b5d4a] underline-offset-2 hover:underline">
                <span className="truncate">{values.profileUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                <UiIcon.External className="h-3 w-3 shrink-0" />
              </a>
              <button type="button" onClick={() => setLinkOpen(true)} className="font-semibold text-[#616a64] underline-offset-2 hover:text-[#1a201c] hover:underline">
                Change link
              </button>
            </p>
          ) : null}

          {noteOpen ? (
            <Field label="Note for the reviewer" optional htmlFor={ids.notes} error={visibleError("notes")}>
              <input
                id={ids.notes}
                value={values.notes}
                maxLength={ACCOUNT_LIMITS.notes}
                onChange={(event) => set("notes", event.target.value)}
                onBlur={() => blur("notes")}
                placeholder="e.g. The account is private until tonight"
                aria-invalid={!!visibleError("notes")}
                className={cx(fieldClass, fieldTone(visibleError("notes")))}
              />
            </Field>
          ) : (
            <button type="button" onClick={() => setNoteOpen(true)} className="text-[12px] font-semibold text-[#616a64] underline-offset-2 hover:text-[#1a201c] hover:underline">
              + Add a note for the team
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <section aria-labelledby={`${uid}-title`} className="@container overflow-hidden rounded-2xl border border-[#dfe3de] bg-white shadow-[0_1px_2px_rgba(26,32,28,0.04)]">
      {/* Header */}
      <div className="flex items-start gap-3 p-4 @md:p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f1f3f0] text-[#1a201c] ring-1 ring-[#e3e5e1]">
          <PlatformGlyph platform={platform} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`${uid}-title`} className="text-[15.5px] font-semibold tracking-[-0.01em] text-[#1a201c]">
            {changesRequested ? `Update your ${platform.label} account` : `Set up your ${platform.label} account`}
          </h3>
          <p className="mt-0.5 text-[12.5px] leading-5 text-[#616a64]">
            {pay ? (
              <>
                Earn <span className="font-semibold text-[#1f5131]">{pay}</span> posting {gig.company}&apos;s reels from a new or existing account.
              </>
            ) : (
              `Post ${gig.company}'s reels from a new or existing account and get paid for approved posts.`
            )}{" "}
            Takes about 5 minutes.
          </p>
        </div>
      </div>

      <div className="h-1 bg-[#eef1ed]" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={steps.filter((step) => step.done).length}>
        <div className="h-full bg-[#2e7d4f] transition-[width] duration-500 ease-out" style={{ width: `${(steps.filter((step) => step.done).length / steps.length) * 100}%` }} />
      </div>

      {changesRequested && setup?.reviewNote ? (
        <div role="alert" className="mx-4 mt-4 rounded-lg border border-[#f3cdc8] bg-[#fdf2f1] px-3.5 py-3 @md:mx-5">
          <div className="text-[12px] font-semibold text-[#8e1f1a]">
            What to fix{setup.reviewedAt ? ` · ${relative(setup.reviewedAt)}` : ""}
          </div>
          <p className="mt-0.5 whitespace-pre-line text-[13px] leading-5 text-[#5c1a16]">{setup.reviewNote}</p>
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        aria-describedby={serverError ? `${uid}-server-error` : undefined}
        className="p-4 @md:p-5"
      >
        <ol className="space-y-0">
          {steps.map((step, index) => (
            <li key={step.title} className="relative flex gap-3.5 pb-6 last:pb-2">
              {/* Rail between step markers */}
              {index < steps.length - 1 ? <span className={cx("absolute left-[13px] top-8 bottom-1 w-px transition-colors", step.done ? "bg-[#9cc9a8]" : "bg-[#e3e5e1]")} aria-hidden="true" /> : null}
              <span
                className={cx(
                  "relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition-colors",
                  step.done ? "bg-[#2e7d4f] text-white" : "bg-[#1f2b24] text-white"
                )}
                aria-hidden="true"
              >
                {step.done ? <UiIcon.Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <h4 className="text-[14px] font-semibold text-[#1a201c]">{step.title}</h4>
                {step.hint ? <p className="mt-0.5 text-[12.5px] leading-5 text-[#616a64]">{step.hint}</p> : null}
                <div className="mt-2.5">{step.body}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-2 space-y-3 border-t border-[#ebedea] pt-4">
          <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-5 text-[#3b443e]">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-[#c5cbc6] accent-[#1f2b24]"
            />
            I own this account and will post the gig&apos;s reels on it once it&apos;s verified.
          </label>

          {serverError ? (
            <p id={`${uid}-server-error`} role="alert" className="flex items-start gap-2 rounded-lg border border-[#f3cdc8] bg-[#fdf2f1] px-3 py-2.5 text-[12.5px] text-[#8e1f1a]">
              <UiIcon.Close className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {serverError}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-3 @md:flex-row @md:items-center @md:justify-between">
            <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-[#7a827c] @md:justify-start">
              <UiIcon.Shield className="h-3.5 w-3.5 shrink-0 text-[#2e7d4f]" />
              No password needed
            </p>
            <div className="flex flex-col-reverse gap-2 @md:flex-row">
              {editing ? (
                <Button
                  size="lg"
                  className="w-full @md:w-auto"
                  onClick={() => {
                    setEditing(false);
                    setServerError(null);
                  }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" variant="primary" size="lg" className="w-full @md:w-auto" disabled={submitting} aria-disabled={!ready}>
                {submitting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" /> : null}
                {submitting ? (readable ? "Checking bio…" : "Sending…") : changesRequested ? "Resubmit" : editing ? "Save changes" : codeLive && liveHandle ? `Verify @${liveHandle}` : readable ? "Verify account" : "Submit account"}
              </Button>
            </div>
          </div>
          {!ready && Object.values(touched).some(Boolean) && !submitting ? (
            <p className="text-center text-[11.5px] text-[#7a827c] @md:text-right">
              {Object.keys(errors).length ? "Check the username to continue." : !code ? "Loading your code…" : "Confirm you own the account to continue."}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
