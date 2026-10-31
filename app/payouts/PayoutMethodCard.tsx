"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useEffect, useId, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import {
  isValidAccountHolder,
  isValidAccountNumber,
  isValidIfsc,
  isValidUpi,
  normalizeAccountNumber,
  normalizeIfsc,
  type PayoutMethod,
} from "@/lib/payoutDestination";

// Where payouts go: a bank account or a UPI ID. Any new destination is verified by the team before payouts use
// it, and it can't change while a payout is open. Bank account numbers come back from the server masked.

export type PayoutMethodConfig = {
  method?: PayoutMethod;
  upiId: string;
  bank?: { holderName: string; accountNumberMasked: string; ifsc: string };
  verified: boolean;
  verifiedAt?: string;
  updatedAt?: string;
};

export const hasPayoutMethod = (config?: PayoutMethodConfig | null) => Boolean(config?.upiId || config?.bank);
/** "name@okhdfc" or "A/c ••••8901 · HDFC0001234". */
export const payoutMethodLabel = (config?: PayoutMethodConfig | null) =>
  config?.bank ? `A/c ${config.bank.accountNumberMasked} · ${config.bank.ifsc}` : config?.upiId ?? "";

type Draft = { method: PayoutMethod; upiId: string; holder: string; account: string; confirm: string; ifsc: string };
const draftFrom = (config?: PayoutMethodConfig | null): Draft => ({
  // Bank account is the default; creators already paid by UPI start on UPI.
  method: config?.upiId && !config?.bank ? "UPI" : "Bank",
  upiId: config?.upiId ?? "",
  holder: config?.bank?.holderName ?? "",
  account: "",
  confirm: "",
  ifsc: config?.bank?.ifsc ?? "",
});

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");
const inputClass =
  "h-12 w-full rounded-[14px] border border-[#dbe3d7] bg-white px-4 text-[16px] font-medium text-[#1f2e28] outline-none transition placeholder:text-[#a3aaa4] focus:border-[#8db35a] focus:ring-4 focus:ring-[#dce78f]/40 disabled:bg-[#f3f4f1] disabled:text-[#7a827c]";

function Field({ label, hint, error, valid, children }: { label: string; hint?: ReactNode; error?: string | null; valid?: boolean; children: (id: string, describedBy: string) => ReactNode }) {
  const id = useId();
  const describedBy = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-semibold text-[#274537]">{label}</label>
      <span className="relative mt-2 block">
        {children(id, describedBy)}
        {valid !== undefined ? (
          <span className={cx("pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] font-bold", valid ? "text-[#5e8f35]" : "text-[#c26a1a]")} aria-hidden>
            {valid ? "✓" : "!"}
          </span>
        ) : null}
      </span>
      <span id={describedBy} className={cx("mt-1 block text-[12px] leading-5", error ? "font-medium text-[#b42318]" : "text-[#6f7d74]")}>
        {error || hint}
      </span>
    </div>
  );
}

export default function PayoutMethodCard({
  config,
  ready,
  failed,
  locked,
  live,
  autoLabel,
  editorOpen,
  setEditorOpen,
  highlighted,
  sectionRef,
  className,
  getToken,
  onSaved,
}: {
  config: PayoutMethodConfig | null;
  ready: boolean;
  failed: boolean;
  /** A payout is open: the destination can't change until it finishes. */
  locked: boolean;
  live: boolean;
  autoLabel: string;
  editorOpen: boolean;
  setEditorOpen: (open: boolean) => void;
  highlighted: boolean;
  sectionRef: RefObject<HTMLElement | null>;
  className: string;
  getToken: () => Promise<string | undefined>;
  onSaved: (next: PayoutMethodConfig & Record<string, unknown>, message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(config));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!editorOpen) return;
    queueMicrotask(() => { setDraft(draftFrom(config)); setError(null); setTouched(false); });
    // Reset only when the editor opens; live updates mustn't wipe what the creator is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen]);

  const has = hasPayoutMethod(config);
  const isBank = Boolean(config?.bank);
  const state = !ready ? "loading" : failed ? "unavailable" : !has ? "none" : config?.verified ? "verified" : "pending";
  const chip = {
    unavailable: { text: "Unavailable", className: "bg-[#fff4d6] text-[#8a5a00] ring-[#f1dea6]" },
    loading: { text: "…", className: "bg-[#f3f4f1] text-[#6f7d74] ring-[#e6ebe2]" },
    none: { text: "Not added", className: "bg-[#fff4d6] text-[#8a5a00] ring-[#f1dea6]" },
    pending: { text: "Verifying", className: "bg-[#eef4fb] text-[#1f5fa8] ring-[#cfe0f5]" },
    verified: { text: "✓ Verified", className: "bg-[#e3f1d6] text-[#2f6a1f] ring-[#c6e0b0]" },
  }[state];
  const destinationNoun = isBank ? "bank account" : "UPI ID";

  // Validation, shown once a field has content (or after a save attempt).
  const upiOk = isValidUpi(draft.upiId);
  const holderOk = isValidAccountHolder(draft.holder);
  const accountOk = isValidAccountNumber(draft.account);
  const confirmOk = accountOk && normalizeAccountNumber(draft.confirm) === normalizeAccountNumber(draft.account);
  const ifscOk = isValidIfsc(draft.ifsc);
  const valid = draft.method === "UPI" ? upiOk && draft.upiId.trim() !== (config?.bank ? "" : config?.upiId ?? "") : holderOk && accountOk && confirmOk && ifscOk;
  const show = (value: string) => touched || value.trim().length > 0;
  const set = (patch: Partial<Draft>) => { setError(null); setDraft((previous) => ({ ...previous, ...patch })); };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid || saving || locked) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const body = draft.method === "UPI"
        ? { method: "UPI", upiId: draft.upiId.trim() }
        : { method: "Bank", accountHolder: draft.holder, accountNumber: normalizeAccountNumber(draft.account), ifsc: normalizeIfsc(draft.ifsc) };
      const res = await fetch("/api/upi", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const next = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(next?.error || "Your payout details couldn't be saved.");
      setDraft((previous) => ({ ...previous, account: "", confirm: "" }));
      setEditorOpen(false);
      onSaved(next, next.verified
        ? "Payout details saved."
        : `${draft.method === "Bank" ? "Bank account" : "UPI ID"} saved. The team will verify it, and this page updates the moment they do.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your payout details couldn't be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      ref={sectionRef}
      aria-labelledby="payout-method-heading"
      className={cx(className, highlighted && "!ring-2 !ring-[#8db35a] shadow-[0_0_0_6px_rgba(141,179,90,0.18)]")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[11.5px] font-black tracking-tight", state === "verified" ? "bg-[#41695b] text-white" : "bg-[#f0f4ec] text-[#41695b]")}
            aria-hidden
          >
            {isBank ? (
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M3 8 10 4l7 4M4.5 8.5v6m3.5-6v6m4-6v6m3.5-6v6M3 16.5h14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : "UPI"}
          </span>
          <div className="min-w-0">
            <h2 id="payout-method-heading" className="text-[12.5px] font-semibold text-[#5f6f65]">
              {isBank ? "Payout bank account" : "Payout method"}
            </h2>
            {state === "loading" ? (
              <span className="mt-1 block h-5 w-40 animate-pulse rounded-md bg-[#e8eee5]" aria-hidden />
            ) : (
              <div className={cx("break-all text-[16px] font-semibold leading-snug", has ? "text-[#20352c]" : "text-[#8a948d]")}>{has ? payoutMethodLabel(config) : "Not added yet"}</div>
            )}
            {config?.bank ? <div className="mt-0.5 break-words text-[12px] text-[#5f6f65]">{config.bank.holderName}</div> : null}
            {has ? <div className="mt-0.5 text-[12px] text-[#5f6f65]">{autoLabel}</div> : null}
          </div>
        </div>
        <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset", chip.className)} aria-live="polite">
          {chip.text}
        </span>
      </div>

      {state === "pending" ? (
        <div className="mt-4 rounded-[14px] bg-[#f3f7fc] p-3 ring-1 ring-inset ring-[#dbe7f5]">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-[#1d4f8f]">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#7fb0e6] opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2a78d6]" />
            </span>
            Waiting for the team to verify your {destinationNoun}
          </p>
          <p className="mt-0.5 text-[12px] leading-5 text-[#4f6476]">
            {live ? "This card updates the moment it's verified." : "We check for the result automatically."}
            {isBank ? " The account holder's name should match your KYC." : ""}
          </p>
        </div>
      ) : state === "verified" ? (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-[#2f6a1f]">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#8db35a] text-[11px] text-white" aria-hidden>✓</span>
          Verified. Payouts go to this {destinationNoun}.
        </p>
      ) : state === "none" ? (
        <p className="mt-3 text-[12.5px] leading-5 text-[#5f6f65]">Add a bank account or UPI ID for your payouts. The team verifies it once, usually within a day.</p>
      ) : state === "unavailable" ? (
        <p className="mt-3 text-[12.5px] leading-5 text-[#825317]">Your payout details couldn&apos;t be loaded. Refresh to try again.</p>
      ) : null}

      {locked && has ? (
        <p className="mt-3 flex gap-2 rounded-[12px] bg-[#fff8e8] px-3 py-2 text-[12px] leading-5 text-[#7a5200]">
          <span aria-hidden>🔒</span>
          Your payout details are locked while a payout is in progress, so it reaches the account it was requested for.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setEditorOpen(!editorOpen)}
        aria-expanded={editorOpen}
        disabled={!ready || failed}
        className={cx(
          "mt-4 inline-flex h-11 w-full items-center justify-center rounded-[14px] text-[14px] font-semibold transition disabled:opacity-50",
          !has && !editorOpen ? "bg-[#41695b] text-white hover:bg-[#35584b]" : "border border-[#dfe7dc] bg-white text-[#41695b] hover:bg-[#f4f7f1]"
        )}
      >
        {editorOpen ? "Close" : has ? "Change payout method" : "Add payout method"}
      </button>

      {editorOpen ? (
        <form onSubmit={save} noValidate className="mt-4 space-y-4 rounded-[18px] bg-[#f8faf5] p-4 ring-1 ring-[#e8eee5]">
          <div role="radiogroup" aria-label="Payout method" className="grid grid-cols-2 gap-1 rounded-[14px] bg-white p-1 ring-1 ring-[#dbe3d7]">
            {(["Bank", "UPI"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={draft.method === option}
                disabled={locked}
                onClick={() => { set({ method: option }); setTouched(false); }}
                className={cx(
                  "h-10 rounded-[10px] text-[13.5px] font-semibold transition disabled:opacity-60",
                  draft.method === option ? "bg-[#41695b] text-white shadow-sm" : "text-[#41695b] hover:bg-[#f4f7f1]"
                )}
              >
                {option === "UPI" ? "UPI ID" : "Bank account"}
              </button>
            ))}
          </div>

          {draft.method === "UPI" ? (
            <Field
              label="UPI ID"
              valid={show(draft.upiId) ? upiOk : undefined}
              error={show(draft.upiId) && !upiOk ? "Enter a UPI ID like name@okhdfcbank." : null}
              hint={locked ? "Locked while a payout is in progress." : "Find it in your UPI app's profile, e.g. name@okicici."}
            >
              {(id, describedBy) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  value={draft.upiId}
                  onChange={(e) => set({ upiId: e.target.value })}
                  placeholder="yourname@okhdfcbank"
                  inputMode="email"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  disabled={locked}
                  aria-invalid={show(draft.upiId) && !upiOk}
                  className={cx(inputClass, "pr-11")}
                />
              )}
            </Field>
          ) : (
            <div className="grid gap-4">
              <Field
                label="Account holder's name"
                valid={show(draft.holder) ? holderOk : undefined}
                error={show(draft.holder) && !holderOk ? "Use the name exactly as on the bank account (letters, spaces, . ' -)." : null}
                hint="Exactly as on your bank account. It should match your KYC."
              >
                {(id, describedBy) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.holder}
                    onChange={(e) => set({ holder: e.target.value })}
                    placeholder="Full name"
                    autoComplete="name"
                    autoFocus
                    disabled={locked}
                    maxLength={100}
                    aria-invalid={show(draft.holder) && !holderOk}
                    className={cx(inputClass, "pr-11")}
                  />
                )}
              </Field>
              <div className="grid gap-4 min-[520px]:grid-cols-2">
                <Field
                  label="Account number"
                  valid={show(draft.account) ? accountOk : undefined}
                  error={show(draft.account) && !accountOk ? "9 to 18 digits." : null}
                  hint={config?.bank ? `Currently ${config.bank.accountNumberMasked}. Enter the full number.` : "9 to 18 digits, no spaces needed."}
                >
                  {(id, describedBy) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      value={draft.account}
                      onChange={(e) => set({ account: e.target.value.replace(/[^\d\s]/g, "") })}
                      placeholder="000123456789"
                      inputMode="numeric"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={locked}
                      maxLength={22}
                      aria-invalid={show(draft.account) && !accountOk}
                      className={cx(inputClass, "pr-11 tabular-nums tracking-wide")}
                    />
                  )}
                </Field>
                <Field
                  label="Re-enter account number"
                  valid={show(draft.confirm) ? confirmOk : undefined}
                  error={show(draft.confirm) && !confirmOk ? "The account numbers don't match." : null}
                  hint="To make sure there's no typo."
                >
                  {(id, describedBy) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      value={draft.confirm}
                      onChange={(e) => set({ confirm: e.target.value.replace(/[^\d\s]/g, "") })}
                      placeholder="000123456789"
                      inputMode="numeric"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={locked}
                      maxLength={22}
                      aria-invalid={show(draft.confirm) && !confirmOk}
                      className={cx(inputClass, "pr-11 tabular-nums tracking-wide")}
                    />
                  )}
                </Field>
              </div>
              <Field
                label="IFSC"
                valid={show(draft.ifsc) ? ifscOk : undefined}
                error={show(draft.ifsc) && !ifscOk ? "11 characters: 4 letters, a 0, then 6 letters or digits (e.g. HDFC0001234)." : null}
                hint="On your cheque book, passbook or bank app, e.g. HDFC0001234."
              >
                {(id, describedBy) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.ifsc}
                    onChange={(e) => set({ ifsc: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                    placeholder="HDFC0001234"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={locked}
                    maxLength={11}
                    aria-invalid={show(draft.ifsc) && !ifscOk}
                    className={cx(inputClass, "pr-11 uppercase tracking-wide")}
                  />
                )}
              </Field>
            </div>
          )}

          <p className="rounded-[12px] bg-white px-3 py-2 text-[12px] leading-5 text-[#5f6f65] ring-1 ring-inset ring-[#e8eee5]">
            {locked
              ? "You can change your payout details once the current payout finishes."
              : "A new payout method is verified by the team before payouts use it, usually within a day."}
          </p>

          {error ? (
            <div role="alert" className="rounded-[12px] border border-[#f6cdc8] bg-[#fdecea] px-3 py-2 text-[13px] font-semibold text-[#b42318]">{error}</div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-[1fr_auto]">
            <button
              type="submit"
              disabled={saving || locked || (!valid && draft.method === "UPI")}
              className="inline-flex h-11 items-center justify-center rounded-[14px] bg-[#41695b] px-5 text-[14px] font-semibold text-white transition hover:bg-[#35584b] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save and send for verification"}
            </button>
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="inline-flex h-11 items-center justify-center rounded-[14px] border border-[#dfe7dc] bg-white px-5 text-[14px] font-semibold text-[#41695b] transition hover:bg-[#f4f7f1]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
