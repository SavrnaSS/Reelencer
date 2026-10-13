"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api/client";
import { accountPlatformFor, normalizeHandle, type AccountPlatform } from "@/lib/accountSetup";
import { isSafeMediaUrl } from "@/lib/gigSamples";
import { useVisibleRefresh } from "@/lib/useVisibleRefresh";
import { Button, StatusBadge, formatDate, formatRelative } from "./dashboardUi";

export type WorkAssignment = {
  id: string;
  gigId: string;
  status: string;
  assignedEmail?: string;
  assignedEmails?: string[];
  submittedAt?: string;
  decidedAt?: string;
  earningsReleaseStatus?: "none" | "queued" | "credited" | "blocked";
};
type InboxMessage = {
  id: string;
  subject: string;
  body: string;
  toEmail: string;
  otpCode?: string;
  createdAt?: string;
  readAt?: string | null;
};
type CredentialRow = { handle: string; email: string; password: string; phone: string };

async function readResponse(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : fallback);
  return body;
}

export function GigBriefAssets({ requirements }: { requirements: string[] }) {
  const urls = Array.from(new Set(requirements.flatMap(line => {
    const value = /^media::/i.test(line) ? line.replace(/^media::/i, "").trim() : line.trim();
    return isSafeMediaUrl(value) && (/^media::/i.test(line) || /\.(png|jpe?g|webp|gif|mp4|mov|webm)(?:\?|$)/i.test(value)) ? [value] : [];
  })));
  if (!urls.length) return null;
  return (
    <section className="gig-detail-card min-w-0 p-4 sm:p-5" aria-label="Work files">
      <h3 className="text-[16px] font-semibold text-[#1a201c]">Work files</h3>
      <p className="mt-1 text-[13px] text-[#616a64]">The hiring team&apos;s assets for your approved gig.</p>
      <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
        {urls.map((url, index) => (
          <li key={url} className="min-w-0">
            <a href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-[#d9ddd8] p-3 text-[13px] font-semibold text-[#2b5d4a] hover:bg-[#f4f8f1] focus-visible:outline-2 focus-visible:outline-[#2e7d4f]">
              Open file {index + 1}<span className="mt-0.5 block truncate text-[12px] font-normal text-[#616a64]">{new URL(url).pathname.split("/").pop() || new URL(url).hostname}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Ask the work panel for `gigId` to start the assignment (Email Creator gigs need no approval). Works whether the
 * panel is already mounted (event) or about to mount (pending request it picks up once loaded).
 */
let pendingStartGigId: string | null = null;
export function requestGigWorkStart(gigId: string) {
  pendingStartGigId = gigId;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("gig-work-start", { detail: gigId }));
    window.requestAnimationFrame(() => document.getElementById("gig-work")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

/** Account creation work uses the existing authenticated assignment, inbox and submission APIs. */
export default function GigWorkPanel({ gigId, platform: gigPlatform, workerId, canActivate, applied, onAssignmentUpdated, onOpenWallet }: {
  gigId: string;
  /** The gig's platform ("X", "Instagram"…): the accounts are created there. */
  platform?: string;
  workerId: string;
  canActivate: boolean;
  /** Has applied. Email Creator applications are approved instantly, so applying starts the work automatically. */
  applied: boolean;
  onAssignmentUpdated: (assignment: WorkAssignment) => void;
  onOpenWallet: () => void;
}) {
  const [assignment, setAssignment] = useState<WorkAssignment | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // Before starting: the exact five addresses this gig will assign (own work emails first).
  // After activation: used to tag which assigned addresses are the creator's own work emails.
  const [preview, setPreview] = useState<{ emails: string[]; own: string[] } | null>(null);
  const ownEmails = preview?.own ?? null;
  const autoStarted = useRef(false);
  const active = useRef(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mutationVersion = useRef(0);
  const notify = useRef(onAssignmentUpdated);
  useEffect(() => { notify.current = onAssignmentUpdated; }, [onAssignmentUpdated]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);

  const refresh = useCallback(async () => {
    if (!active.current || inFlight.current || !navigator.onLine) return;
    inFlight.current = true;
    setRefreshing(true);
    const version = mutationVersion.current;
    const request = new AbortController();
    controller.current = request;
    try {
      const params = new URLSearchParams({ gigId, workerId });
      const previewParams = new URLSearchParams({ gigId, preview: "work-emails" });
      const [rows, preview] = await Promise.all([
        readResponse(await apiFetch(`/api/gig-assignments?${params}`, { signal: request.signal }), "Unable to load your assignment."),
        apiFetch(`/api/gig-assignments?${previewParams}`, { signal: request.signal })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null),
      ]);
      if (active.current && Array.isArray(preview?.emails)) {
        const lower = (list: unknown) => (Array.isArray(list) ? list.map((email) => String(email).toLowerCase()) : []);
        setPreview({ emails: lower(preview.emails), own: lower(preview.own) });
      }
      if (!Array.isArray(rows)) throw new Error("Unable to load your assignment.");
      const next: WorkAssignment | null = rows.find(row => row?.id && String(row.gigId) === gigId) ?? null;
      if (!active.current || version !== mutationVersion.current) return;
      setAssignment(next);
      if (next) notify.current(next);
      setLoaded(true);
      const inbox = next ? await readResponse(await apiFetch(`/api/gig-inbox?assignmentId=${encodeURIComponent(next.id)}`, { signal: request.signal }), "Unable to load the inbox.") : [];
      if (!active.current || version !== mutationVersion.current) return;
      setMessages(Array.isArray(inbox) ? inbox : []);
      setLastSyncedAt(new Date().toISOString());
      setError(null);
      setLoaded(true);
    } catch (failure) {
      if (active.current && !request.signal.aborted && version === mutationVersion.current) {
        setError(failure instanceof Error ? failure.message : "Unable to refresh your work.");
        setLoaded(true);
      }
    } finally {
      inFlight.current = false;
      if (active.current) setRefreshing(false);
    }
  }, [gigId, workerId]);
  useVisibleRefresh(refresh, 10_000);
  useEffect(() => {
    const online = () => { void refresh(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [refresh]);

  const activate = async () => {
    if (activating || !canActivate || !loaded || assignment) return;
    mutationVersion.current += 1;
    controller.current?.abort();
    setActivating(true);
    setError(null);
    try {
      const next = await readResponse(await apiFetch("/api/gig-assignments", {
        method: "POST", body: JSON.stringify({ gigId, workerId }),
      }), "Unable to activate your assignment.") as WorkAssignment;
      if (active.current) {
        mutationVersion.current += 1;
        setAssignment(next);
        notify.current(next);
      }
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : "Unable to activate your assignment.");
    } finally {
      if (active.current) setActivating(false);
    }
  };
  // Start when a "Start work" button elsewhere asked for it (now or before this panel finished loading).
  const [startRequested, setStartRequested] = useState(false);
  useEffect(() => {
    const onStart = (event: Event) => {
      if ((event as CustomEvent<string>).detail === gigId) setStartRequested(true);
    };
    window.addEventListener("gig-work-start", onStart);
    if (pendingStartGigId === gigId) queueMicrotask(() => setStartRequested(true));
    return () => window.removeEventListener("gig-work-start", onStart);
  }, [gigId]);
  useEffect(() => {
    if (!(startRequested || applied) || autoStarted.current || !loaded || !canActivate || error) return;
    autoStarted.current = true;
    pendingStartGigId = null;
    if (!assignment) queueMicrotask(() => void activate());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activate reads current state; run once per request
  }, [startRequested, applied, loaded, assignment, canActivate, error]);
  const emails = Array.from(new Set((assignment?.assignedEmails?.length ? assignment.assignedEmails : assignment?.assignedEmail ? [assignment.assignedEmail] : []).map(email => email.trim().toLowerCase())));
  const locked = !!assignment && (!!assignment.submittedAt || assignment.status.toLowerCase() !== "assigned");
  const status = assignment?.earningsReleaseStatus === "credited" ? "Credited" : assignment?.status === "Accepted" ? "Approved" : assignment?.status || "Ready to start";
  const markRead = async (message: InboxMessage) => {
    if (!assignment || message.readAt) return;
    try {
      await readResponse(await apiFetch("/api/gig-inbox/read", {
        method: "POST", body: JSON.stringify({ assignmentId: assignment.id, messageIds: [message.id] }),
      }), "Unable to mark the message as read.");
      if (active.current) setMessages(previous => previous.map(row => row.id === message.id ? { ...row, readAt: new Date().toISOString() } : row));
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : "Unable to update the inbox.");
    }
  };

  return (
    <section id="gig-work" className="gig-detail-card min-w-0 scroll-mt-28 p-4 sm:p-5" aria-label="Your assignment">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="text-[17px] font-semibold text-[#1a201c]">Your assignment</h3><p className="mt-1 text-[13px] text-[#616a64]">{gigPlatform ? `Create five new ${accountPlatformFor(gigPlatform).label} accounts and hand them over for review.` : "Assigned emails, verification codes and account submission."}</p></div>
        {loaded ? <StatusBadge status={status} /> : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-[#616a64]">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
            {lastSyncedAt ? <span className="absolute inline-flex h-full w-full rounded-full bg-[#8dbf98] opacity-60 motion-safe:animate-ping [animation-duration:2.5s]" /> : null}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${lastSyncedAt ? "bg-[#2e7d4f]" : "bg-[#b9c0ba]"}`} />
          </span>
          <span className="truncate">{lastSyncedAt ? `Live · updated ${formatRelative(lastSyncedAt)}` : "Loading your work…"}</span>
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing || activating}
          aria-label="Refresh now"
          title="Refresh now"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#616a64] transition hover:bg-[#f1f3f0] hover:text-[#1a201c] disabled:cursor-default"
        >
          <svg viewBox="0 0 24 24" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
          </svg>
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-lg bg-[#fde4e1] p-3 text-[13px] text-[#8e1f1a]">{error}</p> : null}
      {loaded && !assignment ? (
        <div className="mt-4 rounded-lg border border-dashed border-[#d9ddd8] p-4">
          {preview?.emails.length ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[14px] font-semibold text-[#1a201c]">Your 5 work emails</h4>
                <span className="rounded-full bg-[#eef1ed] px-2 py-0.5 text-[11.5px] font-semibold text-[#2b5d4a]">Reserved for you</span>
              </div>
              <ul className="mt-2 grid min-w-0 gap-1.5 sm:grid-cols-2">
                {preview.emails.map((email) => (
                  <li key={email} className="flex min-w-0 items-center gap-2 rounded-lg bg-[#fafbf9] px-2.5 py-2 text-[12.5px] ring-1 ring-inset ring-[#ebedea]">
                    <span className="min-w-0 flex-1">
                      <span className="block break-all text-[#3b443e]">{email}</span>
                      {preview.own.includes(email) ? <span className="block text-[11px] font-semibold text-[#2b5d4a]">Your work email</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!canActivate ? (
            <p className="mt-3 text-[13px] leading-6 text-[#616a64]">This gig isn&apos;t taking new work right now.</p>
          ) : !applied ? (
            <p className="mt-3 rounded-lg bg-[#f4f9f2] px-3 py-2.5 text-[13px] leading-6 text-[#1f5131] ring-1 ring-inset ring-[#d6e8d2]">
              <span className="font-semibold">Apply now and you&apos;re approved instantly.</span> These emails and their verification inbox open right after you apply.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] leading-6 text-[#616a64]">{activating ? "Approved. Opening your emails and inbox…" : "Approved. Open your emails and their verification inbox."}</p>
              <Button variant="primary" className="w-full sm:w-auto" onClick={() => void activate()} disabled={activating || refreshing}>
                {activating ? "Opening…" : "Open my emails"}
              </Button>
            </div>
          )}

          {preview && preview.own.length < 5 ? (
            <p className="mt-2 text-[12px] text-[#7a827c]">
              Prefer your own addresses? Emails you make in the{" "}
              <a href="/work-email-creator" className="font-semibold text-[#2b5d4a] underline-offset-2 hover:underline">
                Work Email Creator
              </a>{" "}
              are used first.
            </p>
          ) : null}
        </div>
      ) : null}
      {assignment ? (
        <div className="mt-4 space-y-5">
          {locked ? (
            <div role="status" className="rounded-lg border border-[#d9ddd8] bg-[#fafbf9] p-4 text-[13px] leading-6 text-[#3b443e]">
              <p className="font-semibold text-[#1a201c]">{status === "Credited" ? "Earnings credited to your wallet" : status === "Approved" ? "Accounts approved" : status === "Rejected" ? "Submission not approved" : "Accounts submitted for review"}</p>
              <p>{status === "Credited" ? "You can check your balance and withdrawal options in Wallet." : status === "Approved" ? "Eligible earnings are waiting for the team's payout review." : status === "Rejected" ? "Contact the hiring team in Messages for feedback on this submission." : "The team is reviewing your submitted accounts. The result will update here."}</p>
              {assignment.submittedAt ? <p className="mt-1 text-[12px] text-[#616a64]">Submitted {formatDate(assignment.submittedAt)}</p> : null}
              {status === "Credited" ? <Button size="sm" className="mt-2" onClick={onOpenWallet}>Open Wallet</Button> : null}
            </div>
          ) : null}
          {emails.length === 5 ? (
            <AccountWorkspace
              key={assignment.id}
              assignment={assignment}
              emails={emails}
              ownEmails={ownEmails ?? []}
              platform={accountPlatformFor(gigPlatform)}
              messages={messages}
              locked={locked}
              onRead={markRead}
              onCopyFailed={() => setError("Copy isn't available here. Select the text and copy it.")}
              onSaving={() => { mutationVersion.current += 1; controller.current?.abort(); }}
              onSubmitted={() => {
                mutationVersion.current += 1;
                const next = { ...assignment, status: "Submitted", submittedAt: new Date().toISOString() };
                setAssignment(next);
                notify.current(next);
              }}
            />
          ) : (
            <p role="status" className="rounded-lg bg-[#fafbf9] p-3 text-[13px] text-[#616a64]">The hiring team needs to complete your pack of five assigned emails before you can start.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

const SIGNUP_URL: Partial<Record<AccountPlatform["id"], string>> = {
  instagram: "https://www.instagram.com/accounts/emailsignup/",
  youtube: "https://accounts.google.com/signup",
  tiktok: "https://www.tiktok.com/signup/phone-or-email/email",
  x: "https://x.com/i/flow/signup",
  linkedin: "https://www.linkedin.com/signup",
  facebook: "https://www.facebook.com/r.php",
};

/** What to do with the five emails, in order, plus the rules that get submissions rejected. */
function CreationGuide({ platform }: { platform: AccountPlatform }) {
  const name = platform.label;
  const signup = SIGNUP_URL[platform.id];
  const steps: { title: string; body: string }[] = [
    {
      title: `Open ${name} sign-up in a private window`,
      body: `Use an incognito or private window (or log out first) so ${name} doesn't link the new account to your own. Do one account at a time.`,
    },
    {
      title: "Sign up with the assigned email",
      body: `Choose "sign up with email" and paste the email from the card exactly. Each email makes one new account. Don't attach it to an account you already have.`,
    },
    {
      title: "Confirm with the code from this page",
      body: `${name} sends a verification code to that email. It appears on the account's card and in the inbox below within a minute or two.`,
    },
    {
      title: "Set a password and finish the profile",
      body: `Use a strong password that's different for each account. Pick a handle (${platform.handleHint.toLowerCase().replace(/\.$/, "")}) and complete anything ${name} asks for, like a name or date of birth.`,
    },
    {
      title: "Enter the details and submit all five",
      body: "Type the handle and the exact password on each card. Add the phone number only if you used one. Submit once all five are done.",
    },
  ];
  return (
    <details open className="group rounded-xl border border-[#e3e5e1] bg-[#fafbf9] [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3 sm:p-3.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-[#1a201c]">Create 5 new {name} accounts</span>
          <span className="block text-[12.5px] text-[#616a64]">One brand-new account per email below. You&apos;re paid once the team verifies all five.</span>
        </span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-[#616a64] transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m5 8 5 5 5-5" />
        </svg>
      </summary>
      <div className="border-t border-[#ebedea] px-3 pb-3.5 pt-3 sm:px-3.5">
        <ol className="grid gap-3 @[620px]/work:grid-cols-2">
          {steps.map((step, index) => (
            <li key={step.title} className="flex min-w-0 gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1f2b24] text-[11.5px] font-bold text-white" aria-hidden>
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-5 text-[#1a201c]">{step.title}</span>
                <span className="mt-0.5 block text-[12.5px] leading-5 text-[#616a64]">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-3 grid gap-2 rounded-lg bg-white p-3 text-[12.5px] leading-5 ring-1 ring-inset ring-[#ebedea] @[620px]/work:grid-cols-2">
          <p className="text-[#3b443e]">
            <span className="font-semibold text-[#9a3a2f]">Gets rejected: </span>
            reusing an existing account, using your own email, changing the email or password after you submit, or turning on two-factor login.
          </p>
          <p className="text-[#3b443e]">
            <span className="font-semibold text-[#1f5131]">Why we need the password: </span>
            the team signs in to check each account before paying you. Passwords are stored encrypted.
          </p>
        </div>
        {signup ? (
          <a href={signup} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1f2b24] px-3.5 text-[13px] font-semibold text-white transition hover:bg-[#2b3a31]">
            Open {name} sign-up
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M8 4h8v8M16 4 6 14" />
            </svg>
          </a>
        ) : null}
      </div>
    </details>
  );
}

/** "local.part@domain" with break points only between parts, so long addresses never split mid-word. */
function EmailText({ email }: { email: string }) {
  const [local, domain] = email.split("@");
  const parts = local.split(".");
  return (
    <span className="font-mono text-[12.5px] [overflow-wrap:normal] [word-break:normal]">
      {parts.map((part, index) => (
        <span key={index}>
          {index ? "." : ""}
          {index ? <wbr /> : null}
          <span className="text-[#1a201c]">{part}</span>
        </span>
      ))}
      <wbr />
      <span className="text-[#7a827c]">@{domain}</span>
    </span>
  );
}

function useCopy(onFailed: () => void) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 1500);
    } catch {
      onFailed();
    }
  };
  return { copied, copy };
}

function CopyIconButton({ value, label, copied, onCopy }: { value: string; label: string; copied: boolean; onCopy: (value: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(value)}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[12px] font-semibold transition ${copied ? "bg-[#e3f1df] text-[#1f5131]" : "text-[#2b5d4a] hover:bg-[#eef1ed]"}`}
    >
      {copied ? (
        "Copied"
      ) : (
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
          <path d="M7 7V4.5h8.5V13H13M4.5 7H13v8.5H4.5z" />
        </svg>
      )}
    </button>
  );
}

/**
 * The work, organised by account: each of the five assigned emails is a card with its latest verification code
 * (from the inbox) and the handle/password fields for the account made with it; the full inbox sits below.
 */
function AccountWorkspace({
  assignment,
  emails,
  ownEmails,
  platform,
  messages,
  locked,
  onRead,
  onCopyFailed,
  onSaving,
  onSubmitted,
}: {
  assignment: WorkAssignment;
  emails: string[];
  ownEmails: string[];
  platform: AccountPlatform;
  messages: InboxMessage[];
  locked: boolean;
  onRead: (message: InboxMessage) => void;
  onCopyFailed: () => void;
  onSaving: () => void;
  onSubmitted: () => void;
}) {
  const [rows, setRows] = useState<CredentialRow[]>(() => emails.map((email) => ({ email, handle: "", password: "", phone: "" })));
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const { copied, copy } = useCopy(onCopyFailed);
  const signup = SIGNUP_URL[platform.id];

  const byEmail = (email: string) => messages.filter((m) => m.toEmail?.toLowerCase() === email);
  const unreadFor = (email: string) => byEmail(email).filter((m) => !m.readAt).length;
  const complete = (row: CredentialRow) => !!row.handle.trim() && !!row.password;
  const done = rows.filter(complete).length;
  const update = (index: number, field: "handle" | "password" | "phone", value: string) =>
    setRows((previous) => previous.map((row, ordinal) => (ordinal === index ? { ...row, [field]: value } : row)));
  const visible = messages.filter((m) => !filter || m.toEmail?.toLowerCase() === filter);
  const openMessage = messages.find((m) => m.id === openMessageId);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || locked) return;
    setTouched(true);
    if (rows.length !== 5 || rows.some((row) => !complete(row) || !emails.includes(row.email))) {
      setError("Fill in the handle and password for all five accounts.");
      setActive(Math.max(0, rows.findIndex((row) => !complete(row))));
      return;
    }
    const handles = rows.map((row) => normalizeHandle(row.handle, platform).toLowerCase());
    if (new Set(handles).size !== handles.length) {
      setError("Each account needs its own handle. Two of your accounts have the same one.");
      return;
    }
    if (!confirmed) {
      setError("Confirm that these are five new accounts and the details are correct.");
      return;
    }
    setSaving(true);
    setError(null);
    onSaving();
    try {
      await readResponse(
        await apiFetch("/api/gig-credentials", {
          method: "POST",
          body: JSON.stringify({ assignmentId: assignment.id, accounts: rows.map((row) => ({ ...row, handle: normalizeHandle(row.handle, platform) || row.handle.trim(), phone: row.phone.trim() })) }),
        }),
        "Unable to submit your accounts."
      );
      setRows((previous) => previous.map((row) => ({ ...row, password: "" })));
      onSubmitted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to submit your accounts.");
    } finally {
      setSaving(false);
    }
  };

  const field =
    "w-full min-w-0 rounded-lg border border-[#d9ddd8] bg-white px-3 py-2 text-[16px] text-[#1a201c] outline-none transition placeholder:text-[#a3aaa4] focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20 aria-[invalid=true]:border-[#e8a39b] sm:text-[13px]";

  return (
    <div className="@container/work space-y-5">
      {!locked ? <CreationGuide platform={platform} /> : null}

      <form onSubmit={(event) => void submit(event)} aria-label="Your five accounts" noValidate>
        {/* Progress: one step per account */}
        {!locked ? (
          <div className="mb-3 grid grid-cols-5 gap-1.5" role="tablist" aria-label="Accounts">
            {rows.map((row, index) => {
              const isDone = complete(row);
              const current = active === index;
              const hasCode = byEmail(emails[index]).some((m) => m.otpCode);
              return (
                <button
                  key={index}
                  type="button"
                  role="tab"
                  aria-selected={current}
                  aria-label={`Account ${index + 1}${isDone ? ", ready" : ""}`}
                  onClick={() => setActive(index)}
                  className={`group flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 pb-1.5 pt-2 transition ${current ? "bg-[#f1f6f0]" : "hover:bg-[#f7f8f6]"}`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold transition ${
                      isDone ? "bg-[#2e7d4f] text-white" : current ? "bg-[#1f2b24] text-white" : "bg-[#eef1ed] text-[#2b5d4a]"
                    }`}
                  >
                    {isDone ? "✓" : index + 1}
                  </span>
                  <span className={`truncate text-[10.5px] font-medium ${current ? "text-[#1a201c]" : "text-[#7a827c]"}`}>
                    {isDone ? "Ready" : hasCode ? "Code in" : current ? "Now" : `Acct ${index + 1}`}
                  </span>
                  <span className={`h-0.5 w-full rounded-full ${isDone ? "bg-[#2e7d4f]" : current ? "bg-[#1f2b24]" : "bg-[#e3e5e1]"}`} />
                </button>
              );
            })}
          </div>
        ) : null}

        <ul className="space-y-2">
          {emails.map((email, index) => {
            const row = rows[index];
            const isDone = complete(row);
            const latest = byEmail(email).find((m) => m.otpCode);
            const unread = unreadFor(email);
            const open = !locked && active === index;
            const handleOk = !row.handle.trim() || platform.handleRule.test(normalizeHandle(row.handle, platform));
            const nextIndex = rows.findIndex((r, i) => i !== index && !complete(r));
            return (
              <li
                key={email}
                className={`min-w-0 overflow-hidden rounded-xl border transition ${
                  open ? "border-[#b9d5c0] bg-white shadow-[0_6px_20px_-12px_rgba(31,43,36,0.35)]" : isDone && !locked ? "border-[#cfe3d4] bg-[#fafdf9]" : touched && !locked && !isDone ? "border-[#f0c6c1] bg-white" : "border-[#ebedea] bg-white"
                }`}
              >
                {/* Summary row */}
                <div className="flex min-w-0 items-center gap-2.5 p-2.5 sm:px-3.5">
                  <button
                    type="button"
                    onClick={() => !locked && setActive(open ? -1 : index)}
                    aria-expanded={locked ? undefined : open}
                    disabled={locked}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${isDone && !locked ? "bg-[#2e7d4f] text-white" : open ? "bg-[#1f2b24] text-white" : "bg-[#eef1ed] text-[#2b5d4a]"}`}
                      aria-hidden
                    >
                      {isDone && !locked ? "✓" : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block leading-5">
                        <EmailText email={email} />
                        {ownEmails.includes(email) ? <span className="ml-1.5 whitespace-nowrap rounded-full bg-[#eef1ed] px-1.5 py-px align-middle text-[10px] font-semibold text-[#2b5d4a]">Yours</span> : null}
                      </span>
                      {!open ? (
                        <span className="mt-0.5 block truncate text-[11.5px] text-[#7a827c]">
                          {isDone && !locked
                            ? `@${normalizeHandle(row.handle, platform)} · password saved`
                            : latest?.otpCode
                              ? `Code ${latest.otpCode} · ${formatRelative(latest.createdAt)}`
                              : locked
                                ? "No codes"
                                : row.handle || row.password
                                  ? "In progress"
                                  : "Not started"}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  {unread ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFilter(email);
                        setOpenMessageId(null);
                        document.getElementById("gig-inbox")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                      }}
                      className="shrink-0 rounded-full bg-[#1f2b24] px-2 py-0.5 text-[10.5px] font-semibold text-white"
                    >
                      {unread} new
                    </button>
                  ) : null}
                  <CopyIconButton value={email} label={`Copy ${email}`} copied={copied === email} onCopy={(v) => void copy(v)} />
                  {!locked ? (
                    <button type="button" onClick={() => setActive(open ? -1 : index)} aria-label={open ? "Collapse" : "Expand"} className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#616a64] hover:bg-[#f1f3f0] sm:flex">
                      <svg viewBox="0 0 20 20" className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="m5 8 5 5 5-5" />
                      </svg>
                    </button>
                  ) : null}
                </div>

                {open ? (
                  <div className="border-t border-[#eef0ed] p-3 sm:px-3.5 sm:pb-4">
                    {/* This account's three moves */}
                    <ol className="grid gap-2 @[560px]/work:grid-cols-3">
                      <li className="flex min-w-0 flex-col gap-2 rounded-lg bg-[#fafbf9] p-2.5 ring-1 ring-inset ring-[#ebedea]">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">1 · Copy the email</span>
                        <button type="button" onClick={() => void copy(email)} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition ${copied === email ? "bg-[#e3f1df] text-[#1f5131]" : "bg-white text-[#1a201c] ring-1 ring-inset ring-[#d9ddd8] hover:bg-[#f7f8f6]"}`}>
                          {copied === email ? "Copied ✓" : "Copy email"}
                        </button>
                      </li>
                      <li className="flex min-w-0 flex-col gap-2 rounded-lg bg-[#fafbf9] p-2.5 ring-1 ring-inset ring-[#ebedea]">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">2 · Sign up on {platform.label}</span>
                        {signup ? (
                          <a href={signup} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#1f2b24] text-[13px] font-semibold text-white transition hover:bg-[#2b3a31]">
                            Open sign-up
                            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                              <path d="M8 4h8v8M16 4 6 14" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-[12.5px] leading-5 text-[#3b443e]">Use a private window and sign up with this email.</span>
                        )}
                      </li>
                      <li className={`flex min-w-0 flex-col gap-2 rounded-lg p-2.5 ring-1 ring-inset ${latest?.otpCode ? "bg-[#f4f9f2] ring-[#cfe3d4]" : "bg-[#fafbf9] ring-[#ebedea]"}`}>
                        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">3 · Enter the code</span>
                        {latest?.otpCode ? (
                          <span className="flex h-9 items-center justify-between gap-1 rounded-lg bg-white pl-3 ring-1 ring-inset ring-[#d6e8d2]">
                            <span className="font-mono text-[16px] font-bold tracking-[0.14em] text-[#1f5131]">{latest.otpCode}</span>
                            <CopyIconButton value={latest.otpCode} label="Copy code" copied={copied === latest.otpCode} onCopy={(v) => void copy(v)} />
                          </span>
                        ) : (
                          <span className="flex h-9 items-center gap-2 text-[12.5px] text-[#616a64]">
                            <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                              <span className="absolute inline-flex h-full w-full rounded-full bg-[#c9a227] opacity-60 motion-safe:animate-ping" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#c9a227]" />
                            </span>
                            Waiting for {platform.label}&apos;s code…
                          </span>
                        )}
                      </li>
                    </ol>

                    <div className="mt-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">4 · Enter the new account&apos;s details</div>
                    <div className="mt-2 grid gap-3 @[560px]/work:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                      <label className="block min-w-0 text-[12px] font-medium text-[#3b443e]">
                        {platform.label} handle
                        <input
                          className={`${field} mt-1`}
                          value={row.handle}
                          onChange={(event) => update(index, "handle", event.target.value)}
                          disabled={saving}
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          maxLength={120}
                          placeholder="@username"
                          aria-invalid={(touched && !row.handle.trim()) || !handleOk}
                        />
                        <span className={`mt-1 block text-[11.5px] font-normal ${handleOk ? "text-[#8a928c]" : "text-[#9a5b12]"}`}>{handleOk ? "The username on the new profile." : `Check this handle. ${platform.handleHint}`}</span>
                      </label>
                      <label className="block min-w-0 text-[12px] font-medium text-[#3b443e]">
                        Password
                        <span className="relative mt-1 block">
                          <input
                            className={`${field} pr-14`}
                            type={showPassword[email] ? "text" : "password"}
                            value={row.password}
                            onChange={(event) => update(index, "password", event.target.value)}
                            disabled={saving}
                            autoComplete="new-password"
                            maxLength={1024}
                            aria-invalid={touched && !row.password}
                          />
                          <button type="button" onClick={() => setShowPassword((p) => ({ ...p, [email]: !p[email] }))} className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold text-[#2b5d4a] hover:bg-[#eef1ed]">
                            {showPassword[email] ? "Hide" : "Show"}
                          </button>
                        </span>
                        <span className={`mt-1 block text-[11.5px] font-normal ${row.password && row.password.length < 8 ? "text-[#9a5b12]" : "text-[#8a928c]"}`}>
                          {row.password && row.password.length < 8 ? "Shorter than most platforms allow. Check it." : "Exactly as you set it. Stored encrypted."}
                        </span>
                      </label>
                      <label className="block min-w-0 text-[12px] font-medium text-[#3b443e]">
                        Phone <span className="font-normal text-[#a3aaa4]">(optional)</span>
                        <input className={`${field} mt-1`} type="tel" value={row.phone} onChange={(event) => update(index, "phone", event.target.value)} disabled={saving} autoComplete="off" maxLength={30} placeholder="+91…" />
                        <span className="mt-1 block text-[11.5px] font-normal text-[#8a928c]">Only if {platform.label} asked for one.</span>
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      {isDone ? <span className="mr-auto text-[12px] font-medium text-[#2e7d4f]">✓ Account {index + 1} is ready</span> : null}
                      <button
                        type="button"
                        disabled={!isDone}
                        onClick={() => setActive(nextIndex)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#eef1ed] px-3.5 text-[13px] font-semibold text-[#1f2b24] transition hover:bg-[#e3e8e2] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {nextIndex === -1 ? "Done" : `Next: account ${nextIndex + 1}`}
                        <span aria-hidden>→</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {!locked ? (
          <div className="sticky bottom-0 z-10 -mx-4 mt-3 border-t border-[#ebedea] bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/85 sm:-mx-5 sm:px-5" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            {error ? <p role="alert" className="mb-2 text-[12.5px] font-medium text-[#8e1f1a]">{error}</p> : null}
            {done === 5 ? (
              <label className="mb-2.5 flex items-start gap-2 text-[12.5px] leading-5 text-[#3b443e]">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={saving} className="mt-0.5 h-4 w-4 shrink-0 accent-[#2e7d4f]" />
                <span>I created these five as brand-new {platform.label} accounts with the emails above, and the handles and passwords are correct.</span>
              </label>
            ) : null}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-[#1a201c]">
                  {done}/5 accounts ready
                  {done < 5 ? <span className="font-normal text-[#7a827c]"> · {5 - done} to go</span> : null}
                </div>
                <div className="mt-1 grid max-w-[10rem] grid-cols-5 gap-0.5" aria-hidden>
                  {rows.map((row, index) => (
                    <span key={index} className={`h-1 rounded-full ${complete(row) ? "bg-[#2e7d4f]" : "bg-[#e3e5e1]"}`} />
                  ))}
                </div>
              </div>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? "Submitting…" : "Submit for review"}
              </Button>
            </div>
          </div>
        ) : null}
      </form>

      {/* Full inbox */}
      <section id="gig-inbox" aria-labelledby="gig-inbox-title" className="scroll-mt-28">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 id="gig-inbox-title" className="text-[14px] font-semibold text-[#1a201c]">
            Verification inbox
          </h4>
          <span className="text-[12px] text-[#616a64]">{messages.filter((m) => !m.readAt).length} unread · last 24 hours</span>
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Filter by account">
          {[{ id: "", label: "All", count: messages.filter((m) => !m.readAt).length }, ...emails.map((email, index) => ({ id: email, label: `#${index + 1}`, count: unreadFor(email) }))].map((chip) => (
            <button
              key={chip.id || "all"}
              type="button"
              role="tab"
              aria-selected={filter === chip.id}
              title={chip.id || "All accounts"}
              onClick={() => {
                setFilter(chip.id);
                setOpenMessageId(null);
              }}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition ${filter === chip.id ? "bg-[#1f2b24] text-white" : "bg-white text-[#3b443e] ring-1 ring-inset ring-[#e3e5e1] hover:bg-[#f7f8f6]"}`}
            >
              {chip.label}
              {chip.count ? <span className={`rounded-full px-1.5 text-[10.5px] ${filter === chip.id ? "bg-white/20" : "bg-[#e3f1df] text-[#1f5131]"}`}>{chip.count}</span> : null}
            </button>
          ))}
        </div>
        {visible.length ? (
          <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
            {visible.map((message) => {
              const index = emails.indexOf(message.toEmail?.toLowerCase() ?? "");
              const isOpen = openMessageId === message.id;
              return (
                <li key={message.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => {
                      setOpenMessageId(isOpen ? null : message.id);
                      onRead(message);
                    }}
                    className={`flex w-full min-w-0 items-center gap-3 rounded-lg border p-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-[#2e7d4f] ${isOpen ? "border-[#b9d5c0] bg-[#f4f9f2]" : "border-[#ebedea] hover:bg-[#fafbf9]"}`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${message.readAt ? "bg-[#f1f3f0] text-[#7a827c]" : "bg-[#1f2b24] text-white"}`} aria-hidden>
                      {index >= 0 ? index + 1 : "•"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] ${message.readAt ? "text-[#3b443e]" : "font-semibold text-[#1a201c]"}`}>{message.subject || "Verification message"}</span>
                      <span className="block truncate text-[11.5px] text-[#8a928c]">{formatRelative(message.createdAt)}</span>
                    </span>
                    {message.otpCode ? <span className="shrink-0 rounded-md bg-[#f4f9f2] px-2 py-0.5 font-mono text-[12.5px] font-bold tracking-[0.06em] text-[#1f5131] ring-1 ring-inset ring-[#d6e8d2]">{message.otpCode}</span> : null}
                  </button>
                  {isOpen && openMessage ? (
                    <article aria-label="Verification message" className="mt-1.5 min-w-0 rounded-lg border border-[#b9d5c0] bg-white p-3 text-[13px] text-[#3b443e]">
                      {openMessage.otpCode ? (
                        <div className="mb-2 flex items-center gap-2">
                          <span className="font-mono text-[18px] font-bold tracking-[0.12em] text-[#1f5131]">{openMessage.otpCode}</span>
                          <CopyIconButton value={openMessage.otpCode} label="Copy code" copied={copied === openMessage.otpCode} onCopy={(v) => void copy(v)} />
                        </div>
                      ) : null}
                      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{openMessage.body || "No message content."}</p>
                    </article>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 rounded-lg bg-[#fafbf9] p-3 text-[13px] text-[#616a64]">
            {filter ? "No messages for this account yet." : "No verification messages yet."} Codes appear here and on each account as soon as they arrive.
          </p>
        )}
      </section>
    </div>
  );
}
