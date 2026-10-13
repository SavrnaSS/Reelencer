"use client";

import type { ReactNode } from "react";

// Building blocks for the admin gig form: numbered sections, labelled fields, segmented choices and switches.
// One input height (44px) everywhere so selects, inputs and buttons line up on every screen size.

export const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3.5 text-[16px] text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-[#2f6655] focus:ring-4 focus:ring-[#2f6655]/10 sm:text-sm";
export const textareaCls =
  "w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-[16px] leading-relaxed text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-[#2f6655] focus:ring-4 focus:ring-[#2f6655]/10 sm:text-sm";

export function FormSection({
  id,
  step,
  title,
  description,
  complete,
  children,
}: {
  id: string;
  step: number;
  title: string;
  description?: string;
  complete?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-[9.5rem] border-t border-slate-100 pt-6 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold transition-colors ${
            complete ? "bg-[#2e7d4f] text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          {complete ? (
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="m5 10.5 3.2 3.2L15 7" />
            </svg>
          ) : (
            step
          )}
        </span>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-[15px] font-semibold text-slate-900">
            {title}
          </h3>
          {description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{description}</p> : null}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function Field({
  label,
  required,
  hint,
  wide,
  count,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  wide?: boolean;
  /** Shows "n/max" next to the label (e.g. for briefs). */
  count?: { value: number; max?: number };
  children: ReactNode;
}) {
  return (
    <label className={`block min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-slate-700">
          {label}
          {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
        </span>
        {count ? (
          <span className={`text-[11px] tabular-nums ${count.max && count.value > count.max ? "text-rose-600" : "text-slate-400"}`}>
            {count.value}
            {count.max ? `/${count.max}` : ""}
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-[11.5px] leading-relaxed text-slate-500">{hint}</span> : null}
    </label>
  );
}

/** Pill-style single choice for short option lists (platform, payout type, status). Wraps on narrow screens. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  renderOption,
}: {
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
  label: string;
  renderOption?: (option: T) => ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={`inline-flex h-11 min-w-[4.5rem] flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2f6655]/15 sm:flex-none ${
              active ? "border-[#1f4f43] bg-[#1f4f43] text-white shadow-sm" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
            }`}
          >
            {renderOption ? renderOption(option) : option}
          </button>
        );
      })}
    </div>
  );
}

/** Accessible on/off switch with a title and explanation; the whole row is clickable. */
export function SwitchRow({ checked, onChange, title, description }: { checked: boolean; onChange: (next: boolean) => void; title: string; description: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2f6655]/15 sm:col-span-2 ${
        checked ? "border-[#bcd6c9] bg-[#f3f8f4]" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-500">{description}</span>
      </span>
      <span aria-hidden className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-[#2e7d4f]" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}
