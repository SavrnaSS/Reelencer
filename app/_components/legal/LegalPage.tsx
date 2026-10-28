import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/app/_components/BrandLogo";
import { LEGAL } from "@/lib/legal";
import LegalToc from "./LegalToc";

// Building blocks shared by the privacy policy and the terms of service, so both pages read as one set.

export type IconName = "shield" | "user" | "id" | "wallet" | "link" | "film" | "device" | "lock" | "eye" | "edit" | "trash" | "pause" | "flag" | "people" | "mail" | "clock" | "ban" | "key" | "check" | "alert" | "scale" | "coin";

export function Glyph({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    shield: <><path d="M12 3 4 6v5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-3Z" /><path d="m8.5 11.5 2.5 2.5 4.5-5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    id: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 16a3.4 3.4 0 0 1 6.4 0M14.5 10h4M14.5 13.5h3" /></>,
    wallet: <><path d="M4 7a2 2 0 0 1 2-2h11v4" /><rect x="3" y="8" width="18" height="12" rx="2.5" /><path d="M16 14h2" /></>,
    link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
    film: <><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="m10 9 5 3-5 3V9Z" /></>,
    device: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
    lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
    eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
    edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.5L18 7M9 7V4h6v3" /></>,
    pause: <><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></>,
    flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
    people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    ban: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M14.5 8.5l2 2" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16.5 9" /></>,
    alert: <><path d="M12 3.5 2.5 20h19L12 3.5Z" /><path d="M12 10v4.5M12 17.5h.01" /></>,
    scale: <><path d="M12 4v16M7 20h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0L5 7ZM19 7l-3 6a3 3 0 0 0 6 0l-3-6Z" /></>,
    coin: <><circle cx="12" cy="12" r="9" /><path d="M9 8.5h6M9 11.5h6M12.5 11.5c0 2-1.5 3-3.5 3l4 3M10.5 8.5c1.7 0 2.5 1.2 2.5 3" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Section({ id, index, title, children }: { id: string; index: number; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 border-t border-[#e8ebe7] py-9 first:border-t-0 first:pt-0 sm:py-11 lg:scroll-mt-8">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="text-[13px] font-semibold tabular-nums text-[#2e7d4f]">{String(index + 1).padStart(2, "0")}</span>
        <h2 id={`${id}-title`} className="text-[21px] font-semibold tracking-[-0.02em] text-[#14201a] sm:text-[24px]">
          {title}
        </h2>
        <a href={`#${id}`} className="ml-auto text-[12px] font-medium text-[#a3aaa4] opacity-0 transition hover:text-[#2e7d4f] focus:opacity-100 [section:hover_&]:opacity-100 print:hidden" aria-label={`Link to ${title}`}>
          #
        </a>
      </div>
      <div className="space-y-4 text-[15px] leading-7 text-[#3b443e] [&_strong]:font-semibold [&_strong]:text-[#1a201c]">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span aria-hidden="true" className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#58b52d]" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-[#d8e8dc] bg-[#f3f9f4] px-4 py-3 text-[14px] leading-6 text-[#2c4a37]">{children}</p>;
}


export const CONTACT_EMAIL = LEGAL.email;

export function MailLink({ subject }: { subject?: string }) {
  return (
    <a href={`mailto:${CONTACT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`} className="font-semibold text-[#1f6b3f] underline decoration-[#9fcfae] underline-offset-4 hover:decoration-[#1f6b3f]">
      {CONTACT_EMAIL}
    </a>
  );
}

/** The dark contact card that closes each legal page. */
export function ContactCard({ eyebrow, note, subject, person }: { eyebrow: string; note: string; subject: string; person?: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-[#031713] p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="min-w-0">
        <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#8fe05f]">{eyebrow}</div>
        {person ? <div className="mt-1.5 text-[17px] font-semibold">{person}</div> : null}
        <div className={person ? "mt-0.5 break-all text-[14.5px] font-medium text-white/85" : "mt-1.5 break-all text-[17px] font-semibold"}>{CONTACT_EMAIL}</div>
        {LEGAL.address ? <div className="mt-1 text-[13px] leading-5 text-white/60">{LEGAL.entity}, {LEGAL.address}</div> : null}
        <p className="mt-1 text-[13.5px] leading-6 text-white/65">{note}</p>
      </div>
      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`}
        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#8fe05f] px-5 text-[14px] font-bold text-[#0b1914] transition hover:bg-[#9ae86a]"
      >
        <Glyph name="mail" className="h-4 w-4" />
        Email us
      </a>
    </div>
  );
}

const LEGAL_PAGES = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
];

/**
 * Shared frame for the legal pages: dark hero, an "at a glance" row, sticky contents beside the text (a sticky
 * bar on phones) and a footer linking the other legal page. Sections are passed as children in contents order.
 */
export function LegalPage({
  path,
  title,
  intro,
  effective,
  chips,
  highlights,
  sections,
  children,
}: {
  path: string;
  title: string;
  intro: string;
  effective: { iso: string; label: string };
  chips: Array<{ icon?: IconName; label: string }>;
  highlights: Array<{ icon: IconName; title: string; body: string }>;
  sections: Array<{ id: string; title: string }>;
  children: ReactNode;
}) {
  const other = LEGAL_PAGES.find((page) => page.href !== path);
  return (
    <div className="min-h-screen bg-[#f6f7f4] text-[#1a201c]">
      <header className="relative overflow-hidden bg-[#031713] text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#58b52d]/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-[#2e7d4f]/25 blur-3xl" />
        <div className="relative mx-auto w-full max-w-6xl px-4 pb-12 pt-5 sm:px-6 sm:pb-16 lg:px-8">
          <nav className="flex items-center justify-between gap-3">
            <Link href="/" className="flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8fe05f]" aria-label="Reelencer home">
              <BrandLogo className="h-9 w-9" sizes="36px" />
              <span className="font-[Georgia,Times_New_Roman,serif] text-[1.2rem] font-bold">Reelencer</span>
            </Link>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {other ? (
                <Link href={other.href} className="hidden h-9 items-center rounded-full px-3 text-[13px] font-semibold text-white/70 transition hover:text-white sm:inline-flex">
                  {other.label}
                </Link>
              ) : null}
              <Link href="/" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3.5 text-[13px] font-semibold text-white/85 transition hover:border-white/35 hover:text-white">
                <span aria-hidden="true">←</span>
                Back to home
              </Link>
            </div>
          </nav>
          <div className="mt-10 max-w-3xl sm:mt-14">
            <div className="text-[12px] font-bold uppercase tracking-[0.22em] text-[#8fe05f]">Legal</div>
            <h1 className="mt-3 text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[48px]">{title}</h1>
            <p className="mt-4 max-w-2xl text-[15.5px] leading-7 text-white/72 sm:text-[17px]">{intro}</p>
            <div className="mt-6 flex flex-wrap gap-2 text-[12.5px] font-medium">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-white/85 ring-1 ring-white/12">
                <Glyph name="clock" className="h-3.5 w-3.5 text-[#8fe05f]" />
                Effective <time dateTime={effective.iso}>{effective.label}</time>
              </span>
              {chips.map((chip) => (
                <span key={chip.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-white/85 ring-1 ring-white/12">
                  {chip.icon ? <Glyph name={chip.icon} className="h-3.5 w-3.5 text-[#8fe05f]" /> : null}
                  {chip.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="relative mx-auto -mt-6 w-full max-w-6xl px-4 sm:-mt-8 sm:px-6 lg:px-8">
        <ul className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4" aria-label={`${title} at a glance`}>
          {highlights.map((item) => (
            <li key={item.title} className="flex flex-col gap-2.5 rounded-2xl border border-[#e3e7e2] bg-white p-3.5 shadow-[0_10px_30px_-18px_rgba(3,23,19,0.35)] sm:flex-row sm:gap-3 sm:p-4 lg:flex-col lg:p-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f3ea] text-[#2e7d4f] sm:h-10 sm:w-10">
                <Glyph name={item.icon} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold leading-5 text-[#14201a] sm:text-[14.5px]">{item.title}</span>
                <span className="mt-0.5 block text-[12px] leading-[1.15rem] text-[#5b665f] sm:text-[13px] sm:leading-5">{item.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12 lg:px-8 xl:grid-cols-[16rem_minmax(0,1fr)] xl:gap-16">
        <aside className="lg:pt-1">
          <LegalToc items={sections} label={title} />
        </aside>

        <main className="min-w-0 pt-6 lg:pt-0">
          <article className="-mx-4 max-w-[46rem] bg-white px-5 py-8 ring-1 ring-[#e3e7e2] sm:mx-0 sm:rounded-2xl sm:px-8 sm:py-10 lg:px-10">{children}</article>

          <div className="mt-6 flex max-w-[46rem] flex-col gap-3 px-1 text-[13px] text-[#5b665f] sm:flex-row sm:items-center sm:justify-between print:hidden">
            <span>
              Last updated <time dateTime={effective.iso}>{effective.label}</time>
              {other ? (
                <>
                  {" · "}
                  <Link href={other.href} className="font-semibold text-[#1f6b3f] hover:underline">
                    Read our {other.label}
                  </Link>
                </>
              ) : null}
            </span>
            <a href={`#${sections[0]?.id ?? ""}`} className="font-semibold text-[#1f6b3f] hover:underline">
              Back to top ↑
            </a>
          </div>
        </main>
      </div>
    </div>
  );
}
