"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button, Icon, cx } from "./dashboardUi";

// Profile editing in one place: a live "how brands see you" card on top (updates as you type) and a single form
// for identity + about-you below, with one save bar that only appears when something changed. One PATCH to
// /api/workers saves everything. Field ids match the readiness list so its items can jump here.

export type ProfileFields = { name: string; email: string; headline: string; city: string; bio: string };
export const PROFILE_FIELD_IDS = {
  name: "profile-name",
  email: "profile-email",
  headline: "profile-headline",
  city: "profile-city",
  bio: "profile-bio",
} as const;

const LIMITS = { name: 120, email: 180, headline: 120, city: 80, bio: 600 } as const;
const HEADLINE_STARTERS = ["Lifestyle & food reels creator", "Tech explainers in Hindi & English", "Fashion and beauty UGC creator", "Fitness reels with honest reviews"];
const CITIES = ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh", "Kochi", "Indore", "Goa"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (f: ProfileFields): ProfileFields => ({
  name: f.name.trim(),
  email: f.email.trim().toLowerCase(),
  headline: f.headline.replace(/\s+/g, " ").trim(),
  city: f.city.replace(/\s+/g, " ").trim(),
  bio: f.bio.trim(),
});

function Field({ id, label, hint, error, counter, children }: { id: string; label: string; hint?: ReactNode; error?: string; counter?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-[#1a201c]">
          {label}
        </label>
        {counter}
      </div>
      {children}
      {error ? <p className="mt-1 text-[12px] font-medium text-[#b42318]">{error}</p> : hint ? <div className="mt-1 text-[12px] text-[#7a827c]">{hint}</div> : null}
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  if (!value) return null;
  const near = value.length > max * 0.9;
  return <span className={cx("text-[11px] tabular-nums", near ? "font-semibold text-[#9a5b00]" : "text-[#a3aaa4]")}>{value.length}/{max}</span>;
}

export default function ProfileEditor({
  initial,
  roleLabel,
  workerId,
  userId,
  emailNeedsAttention,
  isGeneratedEmail,
  onSaved,
}: {
  initial: ProfileFields;
  roleLabel: string;
  workerId?: string | null;
  userId?: string | null;
  /** The stored email is a placeholder; ask for the real one. */
  emailNeedsAttention?: boolean;
  isGeneratedEmail: (email: string) => boolean;
  onSaved: (saved: ProfileFields & { workerId?: string; userId?: string; active?: boolean }) => void;
}) {
  const uid = useId();
  const [saved, setSaved] = useState<ProfileFields>(initial);
  const [draft, setDraft] = useState<ProfileFields>(initial);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const next = clean(draft);
  const dirty = (Object.keys(next) as Array<keyof ProfileFields>).some((key) => next[key] !== saved[key]);
  const errors: Partial<Record<keyof ProfileFields, string>> = {};
  if (!next.name) errors.name = "Enter the name brands should see.";
  if (!EMAIL.test(next.email) || isGeneratedEmail(next.email)) errors.email = "Enter the real email you use for this account.";
  const show = (key: keyof ProfileFields) => (touched ? errors[key] : undefined);

  // Strength from what's typed, so the meter moves as you fill things in.
  const parts = [next.name, next.email && !errors.email, next.headline, next.city, next.bio];
  const strength = Math.round((parts.filter(Boolean).length / parts.length) * 100);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const set = (key: keyof ProfileFields) => (event: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [key]: event.target.value.slice(0, LIMITS[key]) }));
    setStatus(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!dirty || busy || Object.keys(errors).length) return;
    setBusy(true);
    setStatus(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/workers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ workerId, userId, ...next }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(payload?.error ?? "Your profile couldn't be saved."));
      const result: ProfileFields = {
        name: String(payload.name ?? next.name).trim() || next.name,
        email: String(payload.email ?? next.email).trim() || next.email,
        headline: String(payload.headline ?? next.headline),
        city: String(payload.city ?? next.city),
        bio: String(payload.bio ?? next.bio),
      };
      setSaved(result);
      setDraft(result);
      setTouched(false);
      onSaved({ ...result, workerId: payload.workerId ? String(payload.workerId) : undefined, userId: payload.userId ? String(payload.userId) : undefined, active: payload.active });
      setStatus({ kind: "success", text: "Profile saved. Brands see the update on your next application." });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Your profile couldn't be saved." });
    } finally {
      setBusy(false);
    }
  };

  const field =
    "mt-1.5 w-full rounded-lg border border-[#d9ddd8] bg-white px-3 text-[16px] text-[#1a201c] shadow-[0_1px_2px_rgba(26,32,28,0.04)] outline-none transition placeholder:text-[#a3aaa4] focus:border-[#7fa58c] focus:ring-2 focus:ring-[#2e7d4f]/20 disabled:bg-[#f7f8f6] aria-[invalid=true]:border-[#e8a39b] sm:text-[13.5px]";
  const initials = useMemo(() => next.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?", [next.name]);
  const complete = strength === 100;

  return (
    <form onSubmit={submit} noValidate className="space-y-4 sm:space-y-5">
      {/* Live preview: exactly what brands see, updating as you type */}
      <section aria-label="How brands see you" className="@container/hero overflow-hidden rounded-xl border border-[#e3e5e1] bg-white shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#f0f1ef] bg-[#fafbf9] px-4 py-2 sm:px-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8a928c]">How brands see you</span>
          {dirty ? <span className="text-[11px] font-semibold text-[#9a5b00]">Preview · not saved yet</span> : <span className="text-[11px] text-[#8a928c]">Live</span>}
        </div>
        <div className="flex flex-col gap-4 p-4 sm:p-5 @[560px]/hero:flex-row @[560px]/hero:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(145deg,#2b3d32,#1a241e)] text-[18px] font-semibold text-white shadow-[0_6px_14px_-8px_rgba(26,36,30,0.7)] @[560px]/hero:h-16 @[560px]/hero:w-16 @[560px]/hero:text-[20px]" aria-hidden="true">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-[17px] font-semibold text-[#1a201c] sm:text-[18px]">{next.name || "Your name"}</span>
                <span className="rounded-full bg-[#eef0ed] px-2 py-0.5 text-[11px] font-semibold text-[#4b544e]">{roleLabel}</span>
              </div>
              <p className={cx("mt-0.5 truncate text-[13.5px]", next.headline ? "font-medium text-[#2b5d4a]" : "italic text-[#a3aaa4]")}>{next.headline || "Add a headline below"}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#616a64]">
                {next.city ? (
                  <span className="inline-flex items-center gap-1">
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                      <path d="M10 17s5-4.4 5-8.5a5 5 0 0 0-10 0C5 12.6 10 17 10 17zM10 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
                    </svg>
                    {next.city}
                  </span>
                ) : null}
                {workerId ? <span className="font-mono text-[11.5px]">{workerId}</span> : null}
              </div>
              {next.bio ? <p className="mt-2 line-clamp-2 whitespace-pre-line text-[12.5px] leading-5 text-[#3b443e]">{next.bio}</p> : null}
            </div>
          </div>
          <div className="w-full shrink-0 @[560px]/hero:w-48">
            <div className="flex items-center justify-between text-[12px] text-[#616a64]">
              <span>Profile strength</span>
              {complete ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#e3f1df] px-1.5 py-px text-[11px] font-semibold text-[#1f5131]">
                  <Icon.Check className="h-3 w-3" /> Complete
                </span>
              ) : (
                <span className="font-semibold tabular-nums text-[#1a201c]">{strength}%</span>
              )}
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e3efe2]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={strength} aria-label="Profile strength">
              <div className="h-full rounded-full bg-[#2e7d4f] transition-[width] duration-500" style={{ width: `${strength}%` }} />
            </div>
          </div>
        </div>
      </section>

      {/* One editor for everything */}
      <section aria-labelledby={`${uid}-edit`} className="@container/edit overflow-hidden rounded-xl border border-[#e3e5e1] bg-white shadow-[0_1px_0_rgba(26,32,28,0.04),0_1px_2px_rgba(26,32,28,0.06)]">
        <div className="px-4 pt-4 sm:px-5">
          <h2 id={`${uid}-edit`} className="text-[14px] font-semibold text-[#1a201c]">
            Edit profile
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[#616a64]">Changes show in the preview above as you type.</p>
        </div>

        <fieldset className="mt-4 px-4 sm:px-5">
          <legend className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8a928c]">Identity</legend>
          <div className="mt-2.5 grid gap-4 @[560px]/edit:grid-cols-2">
            <Field id={PROFILE_FIELD_IDS.name} label="Display name" hint="Shown to brands on applications." error={show("name")}>
              <input id={PROFILE_FIELD_IDS.name} value={draft.name} onChange={set("name")} disabled={busy} autoComplete="name" placeholder="Your name" aria-invalid={!!show("name")} className={cx(field, "h-10")} />
            </Field>
            <Field
              id={PROFILE_FIELD_IDS.email}
              label="Email"
              hint={emailNeedsAttention && next.email === saved.email ? <span className="font-medium text-[#9a5b00]">Add the real email you use, so payout notices reach you.</span> : "Private. Used for updates and payout notices."}
              error={show("email")}
            >
              <input id={PROFILE_FIELD_IDS.email} type="email" value={draft.email} onChange={set("email")} disabled={busy} autoComplete="email" inputMode="email" autoCapitalize="none" placeholder="you@example.com" aria-invalid={!!show("email")} className={cx(field, "h-10")} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="mt-5 border-t border-[#f0f1ef] px-4 pt-4 sm:px-5">
          <legend className="sr-only">About you</legend>
          <div className="flex items-baseline justify-between gap-2" aria-hidden="true">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8a928c]">About you</span>
            <span className="text-[11px] text-[#8a928c]">{[next.headline, next.city, next.bio].filter(Boolean).length}/3 added</span>
          </div>
          <div className="mt-2.5 grid gap-4 @[560px]/edit:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Field id={PROFILE_FIELD_IDS.headline} label="Creator headline" counter={<Counter value={draft.headline} max={LIMITS.headline} />} hint={next.headline ? "Your niche and language in one line." : undefined}>
              <input id={PROFILE_FIELD_IDS.headline} value={draft.headline} onChange={set("headline")} disabled={busy} autoComplete="off" placeholder="e.g. Lifestyle & food reels creator" className={cx(field, "h-10")} />
              {!next.headline ? (
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Headline ideas">
                  {HEADLINE_STARTERS.map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() => {
                        setDraft((d) => ({ ...d, headline: idea }));
                        document.getElementById(PROFILE_FIELD_IDS.headline)?.focus();
                      }}
                      className="rounded-full border border-[#e3e5e1] bg-[#fafbf9] px-2.5 py-1 text-[12px] text-[#3b443e] transition hover:border-[#cfd5cf] hover:bg-white"
                    >
                      + {idea}
                    </button>
                  ))}
                </div>
              ) : null}
            </Field>
            <Field id={PROFILE_FIELD_IDS.city} label="Location" counter={<Counter value={draft.city} max={LIMITS.city} />} hint="For local and on-location briefs.">
              <input id={PROFILE_FIELD_IDS.city} value={draft.city} onChange={set("city")} disabled={busy} list={`${uid}-cities`} autoComplete="address-level2" placeholder="City" className={cx(field, "h-10")} />
              <datalist id={`${uid}-cities`}>
                {CITIES.map((city) => (
                  <option key={city} value={city} />
                ))}
              </datalist>
            </Field>
            <div className="@[560px]/edit:col-span-2">
              <Field id={PROFILE_FIELD_IDS.bio} label="Bio" counter={<Counter value={draft.bio} max={LIMITS.bio} />} hint="What you make, who watches it, and brands you've worked with.">
                <textarea id={PROFILE_FIELD_IDS.bio} value={draft.bio} onChange={set("bio")} disabled={busy} rows={3} placeholder="Short and specific works best." className={cx(field, "min-h-[88px] resize-y py-2.5 leading-6")} />
              </Field>
            </div>
          </div>
        </fieldset>

        {status ? (
          <div
            role="status"
            className={cx(
              "mx-4 mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] sm:mx-5",
              status.kind === "success" ? "border-[#cfe6c9] bg-[#f1f8ef] text-[#1f5131]" : "border-[#f3cdc8] bg-[#fdf2f1] text-[#8e1f1a]"
            )}
          >
            {status.kind === "success" ? <Icon.Check className="mt-0.5 h-4 w-4 shrink-0" /> : <Icon.Close className="mt-0.5 h-4 w-4 shrink-0" />}
            {status.text}
          </div>
        ) : null}

        {/* Save bar: only when there's something to save; sticks to the bottom of the screen on phones. */}
        <div
          className={cx(
            "mt-4 border-t border-[#ebedea] px-4 py-3 sm:px-5",
            dirty ? "sticky bottom-0 z-10 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85" : ""
          )}
          style={dirty ? { paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" } : undefined}
        >
          {dirty ? (
            <div className="flex items-center gap-2">
              <span className="mr-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#9a5b00]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#d99a06]" aria-hidden="true" />
                Unsaved changes
              </span>
              <Button
                variant="plain"
                onClick={() => {
                  setDraft(saved);
                  setTouched(false);
                  setStatus(null);
                }}
                disabled={busy}
              >
                Discard
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-[12.5px] text-[#7a827c]">
              <Icon.Check className="h-3.5 w-3.5 text-[#2e7d4f]" /> All changes saved
            </p>
          )}
        </div>
      </section>
    </form>
  );
}
