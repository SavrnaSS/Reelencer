"use client";

import React, { useState } from "react";
import {
  Avatar,
  ICONS,
  Icon,
  SectionLabel,
  Spinner,
  StatusChip,
  btnDanger,
  btnGhost,
  btnPrimary,
  cardClass,
  fieldClass,
  formatDateTime,
  formatRelative,
} from "./adminUi";
import AccountReview from "./AccountReview";
import type { AccountSetupView } from "@/lib/accountSetup";

export type ReviewDraft = {
  adminNote: string;
  adminExplanation: string;
  whatsappLink: string;
  onboardingSteps: string;
};

export type ApplicationDetailApp = {
  id: string;
  workerId: string;
  workerName?: string;
  status: string;
  appliedAt: string;
  decidedAt?: string;
  proposal?: {
    pitch?: string;
    approach?: string;
    timeline?: string;
    budget?: string;
    portfolio?: string;
    submittedAt?: string;
    reviewStatus?: string;
    adminNote?: string;
    adminExplanation?: string;
    whatsappLink?: string;
    onboardingSteps?: string;
    groupJoinedConfirmed?: boolean;
    groupJoinedConfirmedAt?: string;
    reviewedAt?: string;
    accountSetup?: AccountSetupView;
  };
};

type Decision = "Accepted" | "Rejected" | "Pending";

type Props = {
  app: ApplicationDetailApp;
  gigTitle: string;
  company: string;
  gigTypeLabel?: string;
  isProjectProposal: boolean;
  isDirectApply: boolean;
  draft: ReviewDraft;
  onDraftChange: (patch: Partial<ReviewDraft>) => void;
  onSave: (draft: ReviewDraft) => Promise<void>;
  onDecide: (status: Decision, draft: ReviewDraft) => Promise<void>;
  /** Phones/tablets sheet: pin a compact Approve / Reject / Pending bar to the bottom of the scroll area. */
  stickyDecisions?: boolean;
  /** Content Posting gigs: review the account the creator set up. Approval needs one. */
  account?: {
    platformLabel: string;
    onReveal: () => Promise<string>;
    onRequestChanges: (note: string) => Promise<void>;
  };
};

const STATE_COPY: Record<string, string> = {
  Accepted: "Approved and moved into onboarding.",
  Rejected: "Returned to the worker for a revised submission.",
  Pending: "Under recruiter review.",
  Applied: "New application waiting for first review.",
  Withdrawn: "The worker withdrew this application.",
};

const isUrl = (value: string) => /^https?:\/\//i.test(value.trim());

export default function ApplicationDetail({
  app,
  gigTitle,
  company,
  gigTypeLabel,
  isProjectProposal,
  isDirectApply,
  draft,
  onDraftChange,
  onSave,
  onDecide,
  stickyDecisions = false,
  account,
}: Props) {
  const [busy, setBusy] = useState<Decision | "save" | null>(null);
  const p = app.proposal ?? {};
  const name = app.workerName ?? app.workerId;
  const saved: ReviewDraft = {
    adminNote: p.adminNote ?? "",
    adminExplanation: p.adminExplanation ?? "",
    whatsappLink: p.whatsappLink ?? "",
    onboardingSteps: p.onboardingSteps ?? "",
  };
  const dirty = (Object.keys(saved) as (keyof ReviewDraft)[]).some((k) => (draft[k] ?? "") !== saved[k]);
  const hasProposal = !!(p.pitch || p.approach || p.timeline || p.budget || p.portfolio);

  const run = async (kind: Decision | "save") => {
    setBusy(kind);
    try {
      if (kind === "save") await onSave(draft);
      else await onDecide(kind, draft);
    } finally {
      setBusy(null);
    }
  };

  const setup = p.accountSetup;
  // Content Posting: nothing to approve until the creator has sent the account they'll post from.
  const approveLocked = !!account && !setup && app.status !== "Accepted";
  const approveLabel = app.status === "Accepted" ? "Approved" : account && setup && setup.status !== "Verified" ? "Verify & approve" : "Approve";
  const checklist = [
    { label: hasProposal ? "Proposal received" : "Application received", done: true },
    ...(account ? [{ label: `${account.platformLabel} account submitted`, done: !!setup && setup.status !== "ChangesRequested" }] : []),
    { label: "Recruiter note written", done: !!draft.adminNote.trim() },
    { label: "WhatsApp invite link added", done: !!draft.whatsappLink.trim() },
    { label: "Onboarding steps shared", done: !!draft.onboardingSteps.trim() },
    { label: "Worker joined the group", done: !!p.groupJoinedConfirmed },
  ];

  const facts = [
    p.timeline && { label: isProjectProposal ? "Estimated hours" : "Timeline", value: p.timeline },
    p.budget && { label: isProjectProposal ? "Hourly price" : "Budget note", value: p.budget },
    { label: "Submitted", value: formatDateTime(p.submittedAt ?? app.appliedAt) },
    p.reviewedAt && { label: "Last reviewed", value: formatDateTime(p.reviewedAt) },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <>
    <article className={`${cardClass} overflow-hidden`}>
      {/* Header */}
      <header className="flex flex-wrap items-start gap-3 border-b border-[#eef0ec] px-4 py-4 sm:px-5">
        <Avatar name={name} className="size-11 text-[14px]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-[17px] font-semibold text-[#1a201c] sm:text-[18px]">{name}</h2>
            <StatusChip status={app.status} size="md" />
          </div>
          <div className="mt-0.5 truncate text-[13px] text-[#616a64]">
            {gigTitle} · {company}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px] text-[#4b544e]">
            <Meta icon={ICONS.clock} title={formatDateTime(app.appliedAt)}>
              Applied {formatRelative(app.appliedAt)}
            </Meta>
            {app.decidedAt && (
              <Meta icon={ICONS.check} title={formatDateTime(app.decidedAt)}>
                Reviewed {formatRelative(app.decidedAt)}
              </Meta>
            )}
            {gigTypeLabel && <Meta icon={ICONS.briefcase}>{gigTypeLabel}</Meta>}
            {isDirectApply && !hasProposal && <Meta icon={ICONS.user}>Direct apply</Meta>}
          </div>
        </div>
      </header>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* Main column */}
        <div className="min-w-0 space-y-5 p-4 sm:p-5">
          {account ? (
            <AccountReview
              setup={setup}
              platformLabel={account.platformLabel}
              decided={app.status === "Accepted" || app.status === "Rejected"}
              onReveal={account.onReveal}
              onRequestChanges={account.onRequestChanges}
            />
          ) : null}

          {/* Submission */}
          <section>
            <SectionLabel>{hasProposal ? "Submitted proposal" : "Application"}</SectionLabel>
            {!hasProposal ? (
              <p className="mt-2 rounded-[12px] border border-[#e3e5e1] bg-[#fafbf9] px-3.5 py-3 text-[13px] leading-6 text-[#4b544e]">
                {isDirectApply
                  ? "One-step application. This gig doesn't require proposal fields before recruiter review."
                  : "No proposal details were submitted with this application."}
              </p>
            ) : (
              <div className="mt-2 space-y-3">
                {p.pitch && <Quote label={isProjectProposal ? "Cover letter" : "Pitch"} text={p.pitch} />}
                {p.approach && !isProjectProposal && <Quote label="Approach" text={p.approach} />}
                {p.portfolio && !isProjectProposal && (
                  <div className="text-[13px]">
                    <span className="font-semibold text-[#1a201c]">Portfolio: </span>
                    {isUrl(p.portfolio) ? (
                      <a href={p.portfolio.trim()} target="_blank" rel="noreferrer" className="break-all font-medium text-[#2b5d4a] underline-offset-2 hover:underline">
                        {p.portfolio}
                      </a>
                    ) : (
                      <span className="break-words text-[#4b544e]">{p.portfolio}</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {facts.map((f) => (
                <div key={f.label} className="min-w-0 rounded-[10px] border border-[#eef0ec] bg-[#fafbf9] px-3 py-2">
                  <dt className="truncate text-[11px] font-medium text-[#8a928c]">{f.label}</dt>
                  <dd className="mt-0.5 break-words text-[12.5px] font-semibold text-[#1a201c]">{f.value}</dd>
                </div>
              ))}
            </dl>
            {p.groupJoinedConfirmed && (
              <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-[#c9e3d2] bg-[#ebf5ee] px-3 py-2 text-[12.5px] font-semibold text-[#1d5c37]">
                <Icon d={ICONS.check} className="h-4 w-4" />
                Worker confirmed they joined the WhatsApp group
                {p.groupJoinedConfirmedAt ? <span className="font-normal">· {formatRelative(p.groupJoinedConfirmedAt)}</span> : null}
              </div>
            )}
          </section>

          {/* Recruiter workspace */}
          <section className="rounded-[14px] border border-[#e3e5e1]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef0ec] px-4 py-3">
              <div>
                <h3 className="text-[13.5px] font-semibold text-[#1a201c]">Recruiter message &amp; onboarding</h3>
                <p className="text-[12px] text-[#7a827c]">Shown in the worker&apos;s project panel and included in their email.</p>
              </div>
              {dirty && (
                <span className="inline-flex items-center gap-1.5 rounded-[999px] bg-[#fff6e5] px-2 py-0.5 text-[11.5px] font-semibold text-[#9a5b00]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#e29a1b]" />
                  Unsaved changes
                </span>
              )}
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2">
              <Field label="Admin note">
                <input
                  className={`${fieldClass} h-10`}
                  value={draft.adminNote}
                  onChange={(e) => onDraftChange({ adminNote: e.target.value })}
                  placeholder="Short status note for the worker feed"
                />
              </Field>
              <Field label="WhatsApp group link">
                <div className="relative">
                  <input
                    className={`${fieldClass} h-10 ${draft.whatsappLink.trim() && isUrl(draft.whatsappLink) ? "pr-10" : ""}`}
                    value={draft.whatsappLink}
                    onChange={(e) => onDraftChange({ whatsappLink: e.target.value })}
                    placeholder="https://chat.whatsapp.com/..."
                    inputMode="url"
                  />
                  {draft.whatsappLink.trim() && isUrl(draft.whatsappLink) && (
                    <a
                      href={draft.whatsappLink.trim()}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-[#616a64] hover:bg-[#f1f3f0]"
                      aria-label="Open link"
                    >
                      <Icon d={ICONS.open} className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </Field>
              <Field label="Post-onboarding steps">
                <textarea
                  className={`${fieldClass} h-28 resize-y py-2.5 leading-6`}
                  value={draft.onboardingSteps}
                  onChange={(e) => onDraftChange({ onboardingSteps: e.target.value })}
                  placeholder="After joining group: submit intro message, share worker ID, confirm timezone, and wait for admin checklist."
                />
              </Field>
              <Field label="Admin explanation">
                <textarea
                  className={`${fieldClass} h-28 resize-y py-2.5 leading-6`}
                  value={draft.adminExplanation}
                  onChange={(e) => onDraftChange({ adminExplanation: e.target.value })}
                  placeholder="Explain next steps, reason, or onboarding guidance."
                />
              </Field>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#eef0ec] px-4 py-3 sm:flex-row sm:items-center sm:justify-end">
              <span className="text-[11.5px] text-[#8a928c] sm:mr-auto">Saving keeps the current status. Changed notes or links notify the worker.</span>
              {dirty && (
                <button type="button" className={btnGhost} disabled={!!busy} onClick={() => onDraftChange(saved)}>
                  Discard
                </button>
              )}
              <button type="button" className={btnGhost} disabled={!dirty || !!busy} onClick={() => void run("save")}>
                {busy === "save" ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.save} />}
                Save changes
              </button>
            </div>
          </section>
        </div>

        {/* Decision sidebar */}
        <aside className="space-y-4 border-t border-[#eef0ec] bg-[#fafbf9] p-4 sm:p-5 xl:border-l xl:border-t-0">
          <div>
            <SectionLabel>Decision</SectionLabel>
            <p className="mt-1.5 text-[13px] text-[#4b544e]">{STATE_COPY[app.status] ?? "Review is in progress."}</p>
            {/* In the sheet the pinned bar below carries these actions, so don't repeat them here. */}
            <div className={`mt-3 grid gap-2 ${stickyDecisions ? "hidden" : ""}`}>
              <button type="button" className={`${btnPrimary} h-10`} disabled={!!busy || app.status === "Accepted" || approveLocked} onClick={() => void run("Accepted")}>
                {busy === "Accepted" ? <Spinner /> : <Icon d={ICONS.check} />}
                {approveLabel}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={`${btnDanger} h-10 px-2`} disabled={!!busy || app.status === "Rejected"} onClick={() => void run("Rejected")}>
                  {busy === "Rejected" ? <Spinner className="border-[#b42318]/30 border-t-[#b42318]" /> : <Icon d={ICONS.x} />}
                  Reject
                </button>
                <button type="button" className={`${btnGhost} h-10 px-2`} disabled={!!busy || app.status === "Pending"} onClick={() => void run("Pending")}>
                  {busy === "Pending" ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.pause} />}
                  Pending
                </button>
              </div>
            </div>
            {approveLocked && !stickyDecisions ? <p className="mt-2 text-[11.5px] text-[#9a5b00]">Approval unlocks once the creator sends their {account?.platformLabel} account.</p> : null}
            {dirty && !stickyDecisions && <p className="mt-2 text-[11.5px] text-[#9a5b00]">Your unsaved message edits will be sent with the decision.</p>}
          </div>

          <div>
            <SectionLabel>Onboarding readiness</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-[12.5px]">
                  <span
                    className={`flex size-[18px] shrink-0 items-center justify-center rounded-[999px] ${
                      item.done ? "bg-[#2e7d4f] text-[#fff]" : "border border-[#d9ddd8] bg-[#fff] text-transparent"
                    }`}
                  >
                    <Icon d={ICONS.check} className="h-3 w-3" />
                  </span>
                  <span className={item.done ? "text-[#1a201c]" : "text-[#8a928c]"}>{item.label}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e9ece8]">
              <div
                className="h-full rounded-full bg-[#2e7d4f] transition-[width] duration-500"
                style={{ width: `${Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100)}%` }}
              />
            </div>
          </div>
        </aside>
      </div>
    </article>
    {stickyDecisions ? (
      // Outside the card: its overflow-hidden would stop sticky from working.
      <div className="sticky bottom-0 z-10 -mx-3 mt-3 border-t border-[#e3e5e1] bg-[#fff]/95 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur sm:-mx-5 sm:px-5">
        {approveLocked ? <p className="mb-1.5 text-[11.5px] text-[#9a5b00]">Approval unlocks once the creator sends their {account?.platformLabel} account.</p> : null}
        {dirty ? <p className="mb-1.5 text-[11.5px] text-[#9a5b00]">Unsaved message edits will be sent with the decision.</p> : null}
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <button type="button" className={`${btnPrimary} h-11 px-2`} disabled={!!busy || app.status === "Accepted" || approveLocked} onClick={() => void run("Accepted")}>
            {busy === "Accepted" ? <Spinner /> : <Icon d={ICONS.check} />}
            <span className="truncate">{approveLabel}</span>
          </button>
          <button type="button" className={`${btnDanger} h-11 px-2`} disabled={!!busy || app.status === "Rejected"} onClick={() => void run("Rejected")}>
            {busy === "Rejected" ? <Spinner className="border-[#b42318]/30 border-t-[#b42318]" /> : <Icon d={ICONS.x} />}
            Reject
          </button>
          <button type="button" className={`${btnGhost} h-11 px-2`} disabled={!!busy || app.status === "Pending"} onClick={() => void run("Pending")}>
            {busy === "Pending" ? <Spinner className="border-[#1a201c]/20 border-t-[#1a201c]" /> : <Icon d={ICONS.pause} />}
            Pending
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}

function Meta({ icon, title, children }: { icon: string; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded-[8px] bg-[#f1f3f0] px-2 py-1">
      <Icon d={icon} className="h-3.5 w-3.5 text-[#7a827c]" />
      {children}
    </span>
  );
}

function Quote({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-[12px] border-l-[3px] border-[#2e7d4f] bg-[#fafbf9] px-3.5 py-2.5">
      <div className="text-[11.5px] font-semibold text-[#2b5d4a]">{label}</div>
      <p className="mt-0.5 whitespace-pre-line break-words text-[13.5px] leading-6 text-[#1a201c]">{text}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[12.5px] font-medium text-[#1a201c]">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
