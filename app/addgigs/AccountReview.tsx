"use client";

import { useState } from "react";
import type { AccountSetupView } from "@/lib/accountSetup";
import { ICONS, Icon, SectionLabel, Spinner, StatusChip, btnGhost, btnIcon, btnPrimary, fieldClass, formatDateTime, formatRelative } from "./adminUi";

// Content Posting applications: the account the creator made for the gig. The admin logs in with these details,
// ticks the checks, then approves (sidebar) or sends it back with a note.

const CHANGE_PRESETS = [
  "The login didn't work. Check the email and password.",
  "The username doesn't match the format in the brief.",
  "This account isn't new: it already has posts or followers.",
  "Switch it to a Professional / Creator account.",
  "Add the profile photo and bio from the brief.",
];

const CHECKS = ["Logged in with these details", "Username and profile match the brief", "Fresh account: no old posts or followers"];

const STATUS: Record<AccountSetupView["status"], { label: string; tone: "info" | "warning" | "success" }> = {
  Submitted: { label: "Ready to check", tone: "info" },
  ChangesRequested: { label: "Waiting on creator", tone: "warning" },
  Verified: { label: "Verified", tone: "success" },
};

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      // clipboard unavailable
    }
  };
  return { copied, copy };
}

export default function AccountReview({
  setup,
  platformLabel,
  decided,
  onReveal,
  onRequestChanges,
}: {
  setup?: AccountSetupView;
  platformLabel: string;
  /** Application already approved or rejected: no more change requests. */
  decided: boolean;
  onReveal: () => Promise<string>;
  onRequestChanges: (note: string) => Promise<void>;
}) {
  const { copied, copy } = useCopy();
  const [password, setPassword] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [checks, setChecks] = useState<boolean[]>(() => CHECKS.map(() => setup?.status === "Verified"));
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  if (!setup) {
    return (
      <section>
        <SectionLabel>{platformLabel} account</SectionLabel>
        <div className="mt-2 flex items-start gap-3 rounded-[12px] border border-dashed border-[#e6cf9c] bg-[#fffaf0] px-3.5 py-3">
          <Icon d={ICONS.clock} className="mt-0.5 h-4 w-4 shrink-0 text-[#9a5b00]" />
          <div className="text-[13px] leading-5 text-[#5f4a1c]">
            <div className="font-semibold text-[#4a3a12]">Waiting for the creator to set up the account</div>
            They&apos;ve been asked to create a fresh {platformLabel} account and send its login. Approval unlocks once it arrives.
          </div>
        </div>
      </section>
    );
  }

  const status = STATUS[setup.status];
  const passwordKnown = password !== null;
  const loadPassword = async () => {
    if (passwordKnown) return password;
    setRevealing(true);
    setRevealError(null);
    try {
      const value = await onReveal();
      setPassword(value);
      return value;
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : "Couldn't load the password.");
      return null;
    } finally {
      setRevealing(false);
    }
  };
  const sendChanges = async () => {
    if (!note.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await onRequestChanges(note.trim());
      setComposing(false);
      setNote("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Couldn't send the request.");
    } finally {
      setSending(false);
    }
  };

  const rows: { key: string; label: string; value: string; href?: string; mono?: boolean }[] = [
    { key: "handle", label: "Username", value: `@${setup.handle}`, href: setup.profileUrl || undefined },
    { key: "email", label: "Login email", value: setup.email, mono: true },
    ...(setup.phone ? [{ key: "phone", label: "Phone", value: setup.phone, mono: true }] : []),
  ];
  const checksDone = checks.filter(Boolean).length;

  return (
    <section aria-label={`${platformLabel} account`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>{platformLabel} account</SectionLabel>
        <div className="flex items-center gap-2 text-[11.5px] text-[#7a827c]">
          <span title={formatDateTime(setup.submittedAt)}>
            Sent {formatRelative(setup.submittedAt)}
            {setup.revision > 1 ? ` · revision ${setup.revision}` : ""}
          </span>
          <StatusChip label={status.label} tone={status.tone} />
        </div>
      </div>

      <div className="mt-2 overflow-hidden rounded-[14px] border border-[#e3e5e1]">
        <dl className="divide-y divide-[#eef0ec]">
          {rows.map((row) => (
            <div key={row.key} className="flex min-w-0 items-center gap-2 px-3.5 py-2">
              <dt className="w-24 shrink-0 text-[12px] text-[#7a827c] sm:w-28">{row.label}</dt>
              <dd className={`min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1a201c] ${row.mono ? "tabular-nums" : ""}`}>
                {row.href ? (
                  <a href={row.href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-[#2b5d4a] underline-offset-2 hover:underline">
                    <span className="truncate">{row.value}</span>
                    <Icon d={ICONS.open} className="h-3.5 w-3.5 shrink-0" />
                  </a>
                ) : (
                  row.value
                )}
              </dd>
              <button type="button" className={btnIcon} onClick={() => void copy(row.key, row.key === "handle" ? setup.handle : row.value)} aria-label={`Copy ${row.label.toLowerCase()}`} title="Copy">
                <Icon d={copied === row.key ? ICONS.check : ICONS.copy} className={`h-4 w-4 ${copied === row.key ? "text-[#2e7d4f]" : ""}`} />
              </button>
            </div>
          ))}
          <div className="flex min-w-0 items-center gap-2 px-3.5 py-2">
            <dt className="w-24 shrink-0 text-[12px] text-[#7a827c] sm:w-28">Password</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-[#1a201c]">
              {!setup.hasPassword ? <span className="font-sans font-normal text-[#8a928c]">Not provided</span> : passwordVisible && passwordKnown ? password : "••••••••••"}
            </dd>
            {setup.hasPassword ? (
              <>
                <button
                  type="button"
                  className={btnIcon}
                  disabled={revealing}
                  onClick={async () => {
                    if (passwordVisible) return setPasswordVisible(false);
                    if ((await loadPassword()) !== null) setPasswordVisible(true);
                  }}
                  aria-label={passwordVisible ? "Hide password" : "Reveal password"}
                  title={passwordVisible ? "Hide" : "Reveal"}
                >
                  {revealing ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={passwordVisible ? ICONS.eyeOff : ICONS.eye} className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  className={btnIcon}
                  disabled={revealing}
                  onClick={async () => {
                    const value = await loadPassword();
                    if (value !== null) void copy("password", value);
                  }}
                  aria-label="Copy password"
                  title="Copy"
                >
                  <Icon d={copied === "password" ? ICONS.check : ICONS.copy} className={`h-4 w-4 ${copied === "password" ? "text-[#2e7d4f]" : ""}`} />
                </button>
              </>
            ) : null}
          </div>
        </dl>
        {revealError ? <p className="border-t border-[#f3d3cf] bg-[#fdf2f1] px-3.5 py-2 text-[12px] text-[#8e1f1a]">{revealError}</p> : null}
        {setup.notes ? (
          <div className="border-t border-[#eef0ec] bg-[#fafbf9] px-3.5 py-2.5 text-[12.5px] leading-5 text-[#3b443e]">
            <span className="font-semibold text-[#1a201c]">Creator note: </span>
            {setup.notes}
          </div>
        ) : null}
        {setup.status === "ChangesRequested" && setup.reviewNote ? (
          <div className="border-t border-[#f1e2bf] bg-[#fffaf0] px-3.5 py-2.5 text-[12.5px] leading-5 text-[#5f4a1c]">
            <span className="font-semibold">You asked{setup.reviewedAt ? ` ${formatRelative(setup.reviewedAt)}` : ""}: </span>
            {setup.reviewNote}
          </div>
        ) : null}
      </div>

      {/* Verification aid: not saved, it just keeps the reviewer honest before approving. */}
      {setup.status !== "Verified" ? (
        <div className="mt-3 rounded-[12px] border border-[#e3e5e1] bg-[#fafbf9] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-[#1a201c]">Before approving</span>
            <span className={`text-[11.5px] font-semibold tabular-nums ${checksDone === CHECKS.length ? "text-[#2e7d4f]" : "text-[#7a827c]"}`}>
              {checksDone}/{CHECKS.length}
            </span>
          </div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
            {CHECKS.map((label, index) => (
              <label key={label} className="flex cursor-pointer items-start gap-2 rounded-[8px] px-1 py-1 text-[12.5px] leading-5 text-[#3b443e] hover:bg-[#f1f3f0]">
                <input
                  type="checkbox"
                  checked={checks[index]}
                  onChange={(event) => setChecks((prev) => prev.map((value, i) => (i === index ? event.target.checked : value)))}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#1f2b24]"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {!decided && setup.status !== "Verified" ? (
        composing ? (
          <div className="mt-3 rounded-[12px] border border-[#e6cf9c] bg-[#fffaf0] p-3">
            <label htmlFor="account-change-note" className="text-[12.5px] font-semibold text-[#1a201c]">
              What should the creator change?
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CHANGE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setNote((current) => (current.includes(preset) ? current : current.trim() ? `${current.trim()}\n${preset}` : preset))}
                  className="rounded-[999px] border border-[#e3d3ad] bg-[#fff] px-2.5 py-1 text-left text-[11.5px] font-medium text-[#5f4a1c] transition hover:bg-[#fdf3dc]"
                >
                  {preset}
                </button>
              ))}
            </div>
            <textarea
              id="account-change-note"
              className={`${fieldClass} mt-2 h-24 resize-y py-2.5 leading-6`}
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Be specific: the creator sees this note and gets an email."
            />
            {sendError ? <p className="mt-1.5 text-[12px] text-[#b42318]">{sendError}</p> : null}
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={btnGhost} disabled={sending} onClick={() => setComposing(false)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={sending || !note.trim()} onClick={() => void sendChanges()}>
                {sending ? <Spinner /> : <Icon d={ICONS.send} />}
                Send to creator
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-[#7a827c]">
              {setup.status === "ChangesRequested" ? "The creator can resubmit. You'll see the new details here." : "Approve in the decision panel once every check passes."}
            </p>
            <button type="button" className={`${btnGhost} w-full sm:w-auto`} onClick={() => setComposing(true)}>
              <Icon d={ICONS.chat} />
              {setup.status === "ChangesRequested" ? "Send another note" : "Request changes"}
            </button>
          </div>
        )
      ) : null}
    </section>
  );
}
