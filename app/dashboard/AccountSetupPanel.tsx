"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useId, useMemo, useState, type ReactNode } from "react";
import {
  accountPlatformFor,
  instructionLines,
  isPlatformProfileUrl,
  normalizeHandle,
  parseAccountInstructions,
  payoutPhrase,
  validateAccountSetup,
  type AccountSetupInput,
  type AccountSetupView,
} from "@/lib/accountSetup";
import { Button, Icon as UiIcon, cx, formatRelative } from "./dashboardUi";
import PlatformGlyph from "./PlatformGlyph";

// Content Posting gigs: after applying, the creator makes a fresh account on the gig's platform and submits its
// login here. Screening (the admin checking that account) only starts once it's in.

type Gig = { id: string; title: string; company: string; platform: string; payout?: string; payoutType?: string; requirements: string[] };
export type AccountSetupApplication = { id: string; status: string; proposal?: { accountSetup?: AccountSetupView } };

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

function CopyRow({ label, value, href }: { label: string; value: ReactNode; href?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-3.5 py-2.5">
      <dt className="shrink-0 text-[12px] text-[#616a64]">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13px] font-semibold text-[#1a201c]">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 text-[#2b5d4a] underline-offset-2 hover:underline">
            <span className="truncate">{value}</span>
            <UiIcon.External className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
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
  /** Called with the server's copy of the application after a successful submission. */
  onUpdated: (application: AccountSetupApplication & Record<string, unknown>) => void;
  /** Once verified the account is linked: jump to its analytics. */
  onOpenStats?: () => void;
}) {
  const uid = useId();
  const platform = useMemo(() => accountPlatformFor(gig.platform), [gig.platform]);
  const adminSteps = useMemo(() => instructionLines(parseAccountInstructions(gig.requirements)), [gig.requirements]);
  const setup = application.proposal?.accountSetup;
  const pay = payoutPhrase(gig.payout, gig.payoutType);
  const verified = setup?.status === "Verified" || application.status === "Accepted";
  const changesRequested = setup?.status === "ChangesRequested";

  const [editing, setEditing] = useState(false);
  const formOpen = !verified && (!setup || changesRequested || editing);
  const [values, setValues] = useState<AccountSetupInput>(() => ({
    handle: setup?.handle ?? "",
    profileUrl: setup?.profileUrl ?? "",
    email: setup?.email ?? "",
    password: "",
    phone: setup?.phone ?? "",
    notes: setup?.notes ?? "",
  }));
  // The profile link follows the username until the creator edits it themselves.
  const [urlTouched, setUrlTouched] = useState(!!setup?.profileUrl);
  const [touched, setTouched] = useState<Partial<Record<keyof AccountSetupInput, boolean>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [confirmFresh, setConfirmFresh] = useState(!!setup);
  const [confirmHands, setConfirmHands] = useState(!!setup);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);

  const passwordOptional = !!setup?.hasPassword;
  const errors = validateAccountSetup(values, platform, { passwordOptional });
  const visibleError = (key: keyof AccountSetupInput) => (touched[key] ? errors[key] : undefined);
  const requiredDone = (["handle", "profileUrl", "email", "password"] as const).filter((key) => !errors[key] && (key !== "password" || values.password || passwordOptional)).length;
  const ready = Object.keys(errors).length === 0 && confirmFresh && confirmHands;

  const set = (key: keyof AccountSetupInput, raw: string) =>
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
  const blur = (key: keyof AccountSetupInput) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    // Tidy pasted values: "@Name" or a full profile link become the bare handle.
    if (key === "handle" && values.handle) setValues((prev) => ({ ...prev, handle: normalizeHandle(prev.handle, platform) }));
  };

  const submit = async () => {
    setTouched({ handle: true, profileUrl: true, email: true, password: true, phone: true, notes: true });
    if (!ready || submitting) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const response = await fetch("/api/gig-applications/account-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: application.id, ...values, handle: normalizeHandle(values.handle, platform) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Your account details couldn't be sent. Try again.");
      setValues((prev) => ({ ...prev, password: "" }));
      setShowPassword(false);
      setEditing(false);
      setJustSent(true);
      onUpdated(payload);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Your account details couldn't be sent. Try again.");
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
          <p className="truncate text-[12.5px] text-[#3b443e]">
            {setup ? (
              <>
                <a href={setup.profileUrl} target="_blank" rel="noreferrer noopener" className="font-semibold text-[#2b5d4a] underline-offset-2 hover:underline">
                  @{setup.handle}
                </a>{" "}
                · post the gig&apos;s reels here. {pay ? `You earn ${pay}, paid to your wallet.` : "Approved posts are paid to your wallet."}
              </>
            ) : (
              `Post the gig's reels on this account. ${pay ? `You earn ${pay}, paid to your wallet.` : "Approved posts are paid to your wallet."}`
            )}
          </p>
        </div>
        {onOpenStats ? (
          <Button size="sm" variant="primary" onClick={onOpenStats} className="shrink-0">
            View stats
          </Button>
        ) : null}
      </section>
    );
  }

  const steps = [...platform.steps.slice(0, -1), ...adminSteps, platform.steps[platform.steps.length - 1]];

  /* ---------------- Submitted, waiting for screening ---------------- */
  if (!formOpen && setup) {
    return (
      <section aria-labelledby={`${uid}-title`} className="overflow-hidden rounded-xl border border-[#c9d9ec] bg-white">
        {justSent ? (
          <div role="status" className="flex items-center gap-2 border-b border-[#d7e4f3] bg-[#eef4fb] px-4 py-2.5 text-[12.5px] font-semibold text-[#1f4a73]">
            <UiIcon.Check className="h-4 w-4 shrink-0" />
            {setup.revision > 1 ? "Updated details sent. Screening picks up from here." : "Account sent. Screening has started."}
          </div>
        ) : null}
        <div className="flex flex-wrap items-start gap-3 p-4 sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e0ecf8] text-[#1f4a73]">
            <PlatformGlyph platform={platform} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id={`${uid}-title`} className="text-[15px] font-semibold text-[#1a201c]">
              {platform.label} account in screening
            </h3>
            <p className="mt-0.5 text-[12.5px] leading-5 text-[#616a64]">
              The team will log in to check it matches the brief. Once it&apos;s verified you&apos;ll start posting reels on it. Until then, don&apos;t post or change its login.
            </p>
          </div>
          <Button size="sm" onClick={() => setEditing(true)} className="w-full min-[460px]:w-auto">
            Edit details
          </Button>
        </div>
        <dl className="mx-4 mb-4 divide-y divide-[#ebedea] overflow-hidden rounded-lg border border-[#ebedea] bg-[#fafbf9] sm:mx-5 sm:mb-5">
          <CopyRow label="Profile" value={`@${setup.handle}`} href={setup.profileUrl || undefined} />
          <CopyRow label="Login email" value={setup.email} />
          <CopyRow
            label="Password"
            value={
              <span className="inline-flex items-center gap-1.5">
                <UiIcon.Shield className="h-3.5 w-3.5 text-[#2e7d4f]" />
                Saved, encrypted
              </span>
            }
          />
          {setup.phone ? <CopyRow label="Phone" value={setup.phone} /> : null}
          <CopyRow label="Sent" value={`${formatRelative(setup.submittedAt)}${setup.revision > 1 ? ` · revision ${setup.revision}` : ""}`} />
        </dl>
      </section>
    );
  }

  /* ---------------- Form (first time, after a change request, or editing) ---------------- */
  const ids = { handle: `${uid}-handle`, profileUrl: `${uid}-url`, email: `${uid}-email`, password: `${uid}-password`, phone: `${uid}-phone`, notes: `${uid}-notes` };
  const urlLooksRight = values.profileUrl && isPlatformProfileUrl(values.profileUrl, platform);

  return (
    // Sized by its own width, not the viewport: the card sits in a narrow column on desktop and full width on phones.
    <section aria-labelledby={`${uid}-title`} className="@container overflow-hidden rounded-xl border border-[#ead9b0] bg-white shadow-[0_1px_2px_rgba(26,32,28,0.04)]">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-[#f1e6c8] bg-[#fdf8ec] px-4 py-3.5 sm:px-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#6b4a05] ring-1 ring-[#ead9b0]">
          <PlatformGlyph platform={platform} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={`${uid}-title`} className="text-[15px] font-semibold text-[#1a201c]">
              {changesRequested ? `Update your ${platform.label} account` : `Set up your ${platform.label} account`}
            </h3>
            <span className="rounded-full bg-[#fdf0d2] px-2 py-0.5 text-[11px] font-semibold text-[#6b4a05]">{changesRequested ? "Changes requested" : "Needed for screening"}</span>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-5 text-[#5f5642]">
            You&apos;ll post {gig.company}&apos;s reels on a fresh {platform.label} account you create
            {pay ? (
              <>
                {" "}and earn <span className="font-semibold text-[#3f3524]">{pay}</span>
              </>
            ) : (
              " and get paid for approved posts"
            )}
            . Create it, then share its login so the team can verify it.
          </p>
        </div>
      </div>

      {changesRequested && setup?.reviewNote ? (
        <div role="alert" className="mx-4 mt-4 rounded-lg border border-[#f3cdc8] bg-[#fdf2f1] px-3.5 py-3 sm:mx-5">
          <div className="text-[12px] font-semibold text-[#8e1f1a]">
            {gig.company} asked for changes{setup.reviewedAt ? ` · ${formatRelative(setup.reviewedAt)}` : ""}
          </div>
          <p className="mt-0.5 whitespace-pre-line text-[13px] leading-5 text-[#5c1a16]">{setup.reviewNote}</p>
        </div>
      ) : null}

      <div className="grid gap-5 p-4 @lg:p-5 @4xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] @4xl:gap-6">
        {/* How to */}
        <div className="min-w-0">
          <h4 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">How to set it up</h4>
          <ol className="mt-3 grid gap-3 @2xl:grid-cols-2 @2xl:gap-x-5 @4xl:grid-cols-1">
            {steps.map((step, index) => (
              <li key={`${index}-${step}`} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className={cx(
                    "mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    index === steps.length - 1 ? "bg-[#fdf0d2] text-[#6b4a05]" : "bg-[#eef1ed] text-[#2b5d4a]"
                  )}
                >
                  {index + 1}
                </span>
                <p className="min-w-0 text-[13px] leading-5 text-[#3b443e]">
                  {step}
                  {adminSteps.includes(step) ? <span className="ml-1.5 rounded bg-[#eef1ed] px-1.5 py-px text-[10.5px] font-semibold text-[#2b5d4a]">{gig.company}</span> : null}
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#f4f7f3] px-3 py-2.5 text-[12px] leading-5 text-[#3b443e]">
            <UiIcon.Shield className="mt-0.5 h-4 w-4 shrink-0 text-[#2e7d4f]" />
            <span>The password is encrypted the moment you send it and is only shown to the reviewing team.</span>
          </div>
        </div>

        {/* Form */}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="min-w-0 space-y-4"
          aria-describedby={serverError ? `${uid}-server-error` : undefined}
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a827c]">Account details</h4>
            <span className="text-[11.5px] font-semibold tabular-nums text-[#7a827c]" aria-live="polite">
              {requiredDone}/4 required
            </span>
          </div>

          <div className="grid gap-4 @md:grid-cols-2">
            <Field label="Username" htmlFor={ids.handle} error={visibleError("handle")} hint={platform.handleHint}>
              <div className={cx("flex items-center overflow-hidden rounded-lg border bg-white focus-within:ring-2", fieldTone(visibleError("handle")), "focus-within:border-[#7fa58c]")}>
                <span className="pl-3 text-[15px] text-[#8a928c]" aria-hidden="true">
                  @
                </span>
                <input
                  id={ids.handle}
                  value={values.handle}
                  onChange={(event) => set("handle", event.target.value)}
                  onBlur={() => blur("handle")}
                  placeholder="new.username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={!!visibleError("handle")}
                  aria-describedby={visibleError("handle") ? `${ids.handle}-error` : undefined}
                  className="h-11 min-w-0 flex-1 bg-transparent pl-0.5 pr-3 text-[16px] text-[#1a201c] outline-none placeholder:text-[#9aa29c] sm:text-[14px]"
                />
              </div>
            </Field>

            <Field label="Profile link" htmlFor={ids.profileUrl} error={visibleError("profileUrl")} hint={urlTouched ? "Paste the link from the profile's Share option." : "Filled in from the username. Edit it if it's different."}>
              <div className="relative">
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
                  placeholder={platform.profileUrl("new.username") || "https://"}
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={!!visibleError("profileUrl")}
                  aria-describedby={visibleError("profileUrl") ? `${ids.profileUrl}-error` : undefined}
                  className={cx(fieldClass, fieldTone(visibleError("profileUrl")), urlLooksRight && "pr-11")}
                />
                {urlLooksRight ? (
                  <a
                    href={values.profileUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="Open profile to check it"
                    title="Open profile to check it"
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#616a64] transition hover:bg-[#f1f3f0] hover:text-[#1a201c]"
                  >
                    <UiIcon.External className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            </Field>

            <Field label="Login email" htmlFor={ids.email} error={visibleError("email")} hint="The email the new account was registered with.">
              <input
                id={ids.email}
                type="email"
                inputMode="email"
                value={values.email}
                onChange={(event) => set("email", event.target.value)}
                onBlur={() => blur("email")}
                placeholder="you+brand@example.com"
                autoCapitalize="none"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!visibleError("email")}
                aria-describedby={visibleError("email") ? `${ids.email}-error` : undefined}
                className={cx(fieldClass, fieldTone(visibleError("email")))}
              />
            </Field>

            <Field
              label="Password"
              htmlFor={ids.password}
              error={visibleError("password")}
              hint={passwordOptional ? "Leave empty to keep the password you already sent." : "Use a password you don't use anywhere else."}
            >
              <div className="relative">
                <input
                  id={ids.password}
                  type={showPassword ? "text" : "password"}
                  value={values.password}
                  onChange={(event) => set("password", event.target.value)}
                  onBlur={() => blur("password")}
                  placeholder={passwordOptional ? "••••••••  (saved)" : "Account password"}
                  // "new-password" stops browsers autofilling the creator's own saved password.
                  autoComplete="new-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={!!visibleError("password")}
                  aria-describedby={visibleError("password") ? `${ids.password}-error` : undefined}
                  className={cx(fieldClass, fieldTone(visibleError("password")), "pr-16")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded-md px-2 text-[12px] font-semibold text-[#2b5d4a] transition hover:bg-[#eef1ed]"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>

            <Field label="Phone on the account" optional htmlFor={ids.phone} error={visibleError("phone")} hint="Helps the team pass login checks that send a code.">
              <input
                id={ids.phone}
                type="tel"
                inputMode="tel"
                value={values.phone}
                onChange={(event) => set("phone", event.target.value)}
                onBlur={() => blur("phone")}
                placeholder="+91 98765 43210"
                autoComplete="off"
                aria-invalid={!!visibleError("phone")}
                aria-describedby={visibleError("phone") ? `${ids.phone}-error` : undefined}
                className={cx(fieldClass, fieldTone(visibleError("phone")))}
              />
            </Field>

            <Field label="Note for the reviewer" optional htmlFor={ids.notes} error={visibleError("notes")}>
              <input
                id={ids.notes}
                value={values.notes}
                onChange={(event) => set("notes", event.target.value)}
                onBlur={() => blur("notes")}
                placeholder="e.g. Login codes go to my phone, message me first"
                aria-invalid={!!visibleError("notes")}
                aria-describedby={visibleError("notes") ? `${ids.notes}-error` : undefined}
                className={cx(fieldClass, fieldTone(visibleError("notes")))}
              />
            </Field>
          </div>

          <fieldset className="space-y-2 rounded-lg border border-[#ebedea] bg-[#fafbf9] p-3">
            <legend className="sr-only">Confirm</legend>
            {[
              { checked: confirmFresh, set: setConfirmFresh, label: `I created this ${platform.label} account fresh for this gig. It isn't my personal account.` },
              { checked: confirmHands, set: setConfirmHands, label: "I won't post on it or change its password, email or phone until the team verifies it." },
            ].map((item) => (
              <label key={item.label} className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-5 text-[#3b443e]">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(event) => item.set(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-[#c5cbc6] accent-[#1f2b24]"
                />
                {item.label}
              </label>
            ))}
          </fieldset>

          {serverError ? (
            <p id={`${uid}-server-error`} role="alert" className="flex items-start gap-2 rounded-lg border border-[#f3cdc8] bg-[#fdf2f1] px-3 py-2.5 text-[12.5px] text-[#8e1f1a]">
              <UiIcon.Close className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {serverError}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 @md:flex-row @md:items-center @md:justify-end">
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
              {submitting ? "Sending…" : changesRequested ? "Send updated details" : editing ? "Save changes" : "Submit for screening"}
            </Button>
          </div>
          {!ready && Object.values(touched).some(Boolean) && !submitting ? (
            <p className="text-right text-[11.5px] text-[#7a827c]">
              {Object.keys(errors).length ? "Fix the highlighted fields to continue." : "Tick both confirmations to continue."}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}
