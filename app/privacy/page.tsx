import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/app/_components/BrandLogo";
import { publicPageMetadata } from "@/lib/site";
import PrivacyToc from "./PrivacyToc";

export const metadata: Metadata = publicPageMetadata({
  title: "Privacy Policy",
  description: "How Reelencer collects, uses, shares and protects creator data, including identity verification, linked social accounts and payouts, and how to exercise your privacy rights.",
  path: "/privacy",
});

// Keep the effective date in step with any change to what the policy describes.
const EFFECTIVE = { iso: "2026-10-28", label: "28 October 2026" };
const CONTACT_EMAIL = "support@reelencer.com";

const SECTIONS = [
  { id: "who-we-are", title: "Who we are" },
  { id: "what-we-collect", title: "Information we collect" },
  { id: "how-we-use", title: "How we use it" },
  { id: "sharing", title: "Who we share it with" },
  { id: "social-accounts", title: "Linked social accounts" },
  { id: "security", title: "How we protect it" },
  { id: "retention", title: "How long we keep it" },
  { id: "your-rights", title: "Your rights and choices" },
  { id: "browser-storage", title: "Cookies and browser storage" },
  { id: "children", title: "Age requirement" },
  { id: "transfers", title: "Where data is processed" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact and grievances" },
];

type IconName = "shield" | "user" | "id" | "wallet" | "link" | "film" | "device" | "lock" | "eye" | "edit" | "trash" | "pause" | "flag" | "people" | "mail" | "clock" | "ban" | "key";

function Glyph({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
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
  };
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const HIGHLIGHTS: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: "ban", title: "We don't sell your data", body: "No selling, renting or sharing for advertising. Ever." },
  { icon: "key", title: "No social passwords to link", body: "You prove you own an Instagram account with a code in its bio." },
  { icon: "id", title: "ID only for payouts", body: "Identity documents are used to verify you before we pay you." },
  { icon: "trash", title: "Deletion you can count on", body: "Deleted accounts are permanently removed after a 7-day restore window." },
];

const COLLECTED: Array<{ icon: IconName; title: string; items: string[]; why: string }> = [
  {
    icon: "user",
    title: "Account and profile",
    items: ["Name and email address", "Password (stored only as a secure hash by our sign-in provider)", "Profile details, skills and portfolio links you add"],
    why: "To create your account, sign you in and let our team review your applications.",
  },
  {
    icon: "film",
    title: "Gigs and your work",
    items: ["Applications, proposals, quotes and messages", "Reel links and proof you submit", "For gigs that ask you to create accounts: the handles, emails and passwords you hand over for those accounts"],
    why: "To review applications, check your work and run the gig. Handed-over passwords are encrypted before they're stored.",
  },
  {
    icon: "id",
    title: "Identity verification (KYC)",
    items: ["Legal name, date of birth, phone number and address", "ID type, ID number and a photo of the document", "A live selfie taken in-page with a short on-screen challenge"],
    why: "To confirm you are a real person and the rightful payee before any payout, and to prevent fraud.",
  },
  {
    icon: "wallet",
    title: "Payments",
    items: ["UPI ID and its verification status", "Earnings, payout cycles and payment records"],
    why: "To calculate what you've earned and pay you.",
  },
  {
    icon: "link",
    title: "Linked social accounts",
    items: ["Handle and profile link", "Public profile details: bio, follower and post counts, public reels and their numbers", "Insight screenshots you choose to upload"],
    why: "To confirm the account is yours, track the reels you post for a gig and work out your earnings.",
  },
  {
    icon: "device",
    title: "Device and security",
    items: ["IP addresses and when you were last active", "Sign-in session data", "Basic technical logs (errors and request times)"],
    why: "To keep accounts secure, stop abuse and investigate problems.",
  },
];

const PROVIDERS: Array<{ name: string; role: string; data: string }> = [
  { name: "Supabase", role: "Database, sign-in and file storage", data: "Account, profile, gig, KYC and payment records; uploaded files" },
  { name: "Resend", role: "Transactional email", data: "Your email address and the content of account and gig emails" },
  { name: "Meta (Instagram)", role: "Reading public Instagram profiles", data: "The handle of the account you linked" },
  { name: "Anthropic", role: "Reading numbers from insight screenshots", data: "Only the screenshots you choose to upload" },
  { name: "Cloudflare", role: "Network security and email routing", data: "IP addresses and email delivery data" },
  { name: "Hosting provider", role: "Running the website", data: "Requests to the site, including IP addresses" },
];

const RIGHTS: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: "eye", title: "Access", body: "Ask for a summary of the personal data we hold about you and how it's used." },
  { icon: "edit", title: "Correction", body: "Fix your profile yourself, or ask us to correct anything you can't edit." },
  { icon: "trash", title: "Erasure", body: "Ask us to delete your account and data, subject to records the law requires us to keep." },
  { icon: "pause", title: "Withdraw consent", body: "Stop optional processing at any time. Some features, like payouts, may stop working." },
  { icon: "flag", title: "Grievance", body: "Raise a concern with us and get a response, and escalate to the Data Protection Board of India if needed." },
  { icon: "people", title: "Nominate", body: "Name someone to exercise these rights for you if you're unable to." },
];

function Section({ id, index, title, children }: { id: string; index: number; title: string; children: ReactNode }) {
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

function Bullets({ items }: { items: ReactNode[] }) {
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

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-[#d8e8dc] bg-[#f3f9f4] px-4 py-3 text-[14px] leading-6 text-[#2c4a37]">{children}</p>;
}

export default function PrivacyPage() {
  const mail = <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[#1f6b3f] underline decoration-[#9fcfae] underline-offset-4 hover:decoration-[#1f6b3f]">{CONTACT_EMAIL}</a>;
  return (
    <div className="min-h-screen bg-[#f6f7f4] text-[#1a201c]">
      {/* Hero */}
      <header className="relative overflow-hidden bg-[#031713] text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#58b52d]/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-[#2e7d4f]/25 blur-3xl" />
        <div className="relative mx-auto w-full max-w-6xl px-4 pb-12 pt-5 sm:px-6 sm:pb-16 lg:px-8">
          <nav className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8fe05f]" aria-label="Reelencer home">
              <BrandLogo className="h-9 w-9" sizes="36px" />
              <span className="font-[Georgia,Times_New_Roman,serif] text-[1.2rem] font-bold">Reelencer</span>
            </Link>
            <Link href="/" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3.5 text-[13px] font-semibold text-white/85 transition hover:border-white/35 hover:text-white">
              <span aria-hidden="true">←</span>
              Back to home
            </Link>
          </nav>
          <div className="mt-10 max-w-3xl sm:mt-14">
            <div className="text-[12px] font-bold uppercase tracking-[0.22em] text-[#8fe05f]">Legal</div>
            <h1 className="mt-3 text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[48px]">Privacy Policy</h1>
            <p className="mt-4 max-w-2xl text-[15.5px] leading-7 text-white/72 sm:text-[17px]">
              What we collect when you use Reelencer, why we need it, who sees it and the control you have over it, in plain language.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-[12.5px] font-medium">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-white/85 ring-1 ring-white/12">
                <Glyph name="clock" className="h-3.5 w-3.5 text-[#8fe05f]" />
                Effective <time dateTime={EFFECTIVE.iso}>{EFFECTIVE.label}</time>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-white/85 ring-1 ring-white/12">
                <Glyph name="shield" className="h-3.5 w-3.5 text-[#8fe05f]" />
                Written for India&apos;s DPDP Act, 2023
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-white/85 ring-1 ring-white/12">About 8 minutes to read</span>
            </div>
          </div>
        </div>
      </header>

      {/* At a glance */}
      <div className="relative mx-auto -mt-6 w-full max-w-6xl px-4 sm:-mt-8 sm:px-6 lg:px-8">
        <ul className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4" aria-label="Privacy at a glance">
          {HIGHLIGHTS.map((item) => (
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

      {/* Policy */}
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12 lg:px-8 xl:grid-cols-[16rem_minmax(0,1fr)] xl:gap-16">
        <aside className="lg:pt-1">
          <PrivacyToc items={SECTIONS} />
        </aside>

        <main className="min-w-0 pt-6 lg:pt-0">
          <article className="-mx-4 max-w-[46rem] bg-white px-5 py-8 ring-1 ring-[#e3e7e2] sm:mx-0 sm:rounded-2xl sm:px-8 sm:py-10 lg:px-10">
            <Section id="who-we-are" index={0} title="Who we are">
              <p>
                Reelencer (&ldquo;Reelencer&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) runs a platform that connects creators with paid brand gigs for short-form video, such as Instagram Reels and YouTube Shorts. This policy covers our website, creator dashboard and the emails we send.
              </p>
              <p>
                For the personal data described here, Reelencer is the <strong>data fiduciary</strong>: we decide why and how it&apos;s processed. Gigs are reviewed and managed by the Reelencer team on behalf of the brands behind them.
              </p>
            </Section>

            <Section id="what-we-collect" index={1} title="Information we collect">
              <p>We collect what you give us, what we need to run gigs and pay you, and a small amount of technical data. Here it is, grouped by purpose:</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {COLLECTED.map((group) => (
                  <div key={group.title} className="flex flex-col rounded-xl border border-[#e6e9e5] bg-[#fbfcfa] p-4">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#2e7d4f] ring-1 ring-[#e3e7e2]">
                        <Glyph name={group.icon} className="h-4 w-4" />
                      </span>
                      <h3 className="text-[14.5px] font-semibold text-[#14201a]">{group.title}</h3>
                    </div>
                    <ul className="mt-3 grid gap-1.5 text-[13.5px] leading-6 text-[#3b443e]">
                      {group.items.map((item) => (
                        <li key={item} className="flex gap-2.5">
                          <span aria-hidden="true" className="mt-[10px] h-1 w-1 shrink-0 rounded-full bg-[#8a928c]" />
                          <span className="min-w-0">{item}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-auto border-t border-[#eceee9] pt-3 text-[12.5px] leading-5 text-[#5b665f]">
                      <span className="font-semibold text-[#2e7d4f]">Why: </span>
                      {group.why}
                    </p>
                  </div>
                ))}
              </div>
              <p>We don&apos;t ask for the password of your personal social accounts to link them, and we don&apos;t collect special categories of data beyond what identity verification requires.</p>
            </Section>

            <Section id="how-we-use" index={2} title="How we use it">
              <Bullets
                items={[
                  <><strong>Run your account:</strong> sign-in, your profile, your dashboard and its live updates.</>,
                  <><strong>Run gigs:</strong> review your application and your work, and track progress on each gig.</>,
                  <><strong>Verify accounts and people:</strong> confirm you own a linked account and that you are who you say before we pay you.</>,
                  <><strong>Pay you:</strong> calculate earnings from approved work and send payouts to your verified UPI ID.</>,
                  <><strong>Keep Reelencer safe:</strong> detect fake accounts, fraud and abuse, and suspend access or block connections when needed.</>,
                  <><strong>Talk to you:</strong> account, security, application and payout emails. We don&apos;t send marketing without asking.</>,
                  <><strong>Meet legal duties:</strong> keep records the law requires and respond to lawful requests.</>,
                ]}
              />
              <p>
                We process your data on the basis of the <strong>consent</strong> you give when you create an account and use each feature, and for <strong>legitimate uses</strong> the law allows, such as meeting legal obligations and responding to emergencies.
              </p>
            </Section>

            <Section id="sharing" index={3} title="Who we share it with">
              <p>
                <strong>The Reelencer team</strong> reviews applications, identity verification and payouts. Each team member&apos;s access is limited to what their role needs.
              </p>
              <p>
                <strong>Brands</strong> whose gigs you work on may receive the work you submit and your public account handle. They never receive your identity documents, ID number, address or UPI ID.
              </p>
              <p><strong>Service providers</strong> process data for us under contract, only to provide their service:</p>
              <div className="overflow-hidden rounded-xl border border-[#e6e9e5]">
                <div className="hidden grid-cols-[10rem_1fr_1.2fr] gap-4 bg-[#f6f8f5] px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#7a827c] md:grid">
                  <span>Provider</span>
                  <span>What they do</span>
                  <span>Data involved</span>
                </div>
                <ul className="divide-y divide-[#eceee9]">
                  {PROVIDERS.map((provider) => (
                    <li key={provider.name} className="grid gap-1 px-4 py-3 text-[13.5px] leading-6 md:grid-cols-[10rem_1fr_1.2fr] md:gap-4">
                      <span className="font-semibold text-[#14201a]">{provider.name}</span>
                      <span className="text-[#3b443e]">{provider.role}</span>
                      <span className="text-[#5b665f]">
                        <span className="font-medium text-[#7a827c] md:hidden">Data: </span>
                        {provider.data}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <p>
                <strong>Legal reasons:</strong> we may disclose data when required by law, court order or a government authority, or to protect the rights and safety of our users and Reelencer.
              </p>
              <Note>We never sell your personal data or share it with advertisers or data brokers.</Note>
            </Section>

            <Section id="social-accounts" index={4} title="Linked social accounts">
              <p>When you link an account for a gig, here&apos;s exactly what happens:</p>
              <ol className="grid gap-3">
                {[
                  ["Ownership check", "We give you a short code to add to the account's bio, then read the public profile to find it. No password is involved."],
                  ["Public data only", "We read what anyone can see on the public profile and its public reels: bio, counts, captions and engagement. We can't see your messages, drafts or private insights."],
                  ["Screenshots, if you choose", "If you upload insight screenshots, an AI service reads the numbers from them so you don't have to type them. Screenshots are used only for that."],
                  ["Unlinking", "You can ask us to unlink an account at any time. We stop reading it; earnings records for work already submitted are kept for payouts."],
                ].map(([title, body], index) => (
                  <li key={title} className="flex gap-3.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#14201a] text-[12px] font-semibold text-white">{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-[#14201a]">{title}</span>
                      <span className="block text-[14.5px] leading-6 text-[#4b544e]">{body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Section>

            <Section id="security" index={5} title="How we protect it">
              <Bullets
                items={[
                  "Data is encrypted in transit (HTTPS) between your device and our services.",
                  "Passwords for accounts you hand over for a gig, and our service keys, are encrypted before they're stored.",
                  "Identity documents and selfies are kept in private storage, available only to you and authorised reviewers.",
                  "Team access is role-based and limited to what each person needs; sensitive actions are logged.",
                  "We watch for abuse and can suspend access or block a connection to protect your account and others.",
                ]}
              />
              <p>No system is perfectly secure. If a breach affects your personal data, we&apos;ll notify you and the authorities as the law requires.</p>
            </Section>

            <Section id="retention" index={6} title="How long we keep it">
              <p>We keep personal data while your account is active and for as long as we need it for the purposes above.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["While active", "Account, profile, gig and linked-account data stays while you use Reelencer."],
                  ["After deletion", "Access stops at once. Records, files and sign-in access are permanently removed after a 7-day restore window."],
                  ["Required by law", "Payment and tax records, and data needed for disputes or fraud cases, are kept only as long as the law requires."],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-xl border border-[#e6e9e5] bg-[#fbfcfa] p-4">
                    <div className="text-[13.5px] font-semibold text-[#14201a]">{title}</div>
                    <p className="mt-1 text-[13.5px] leading-6 text-[#4b544e]">{body}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section id="your-rights" index={7} title="Your rights and choices">
              <p>Under India&apos;s Digital Personal Data Protection Act, 2023, you can:</p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {RIGHTS.map((right) => (
                  <li key={right.title} className="flex gap-3 rounded-xl border border-[#e6e9e5] p-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f3ea] text-[#2e7d4f]">
                      <Glyph name={right.icon} className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-semibold text-[#14201a]">{right.title}</span>
                      <span className="mt-0.5 block text-[13.5px] leading-6 text-[#4b544e]">{right.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p>
                To use any of these rights, email {mail} from the address on your account. We&apos;ll confirm it&apos;s you, then respond as soon as we can and within the time the law allows.
              </p>
            </Section>

            <Section id="browser-storage" index={8} title="Cookies and browser storage">
              <p>
                We use only what&apos;s needed to run the site: sign-in session storage to keep you logged in, and browser storage for preferences such as your theme, list or board view and checklist ticks. We don&apos;t use advertising cookies or cross-site trackers.
              </p>
              <p>Clearing your browser data signs you out and resets these preferences.</p>
            </Section>

            <Section id="children" index={9} title="Age requirement">
              <p>
                Reelencer is for people who are <strong>18 or older</strong>. We don&apos;t knowingly collect data from children. If you believe a child has signed up, contact us and we&apos;ll delete the account.
              </p>
            </Section>

            <Section id="transfers" index={10} title="Where data is processed">
              <p>
                Some of our service providers store or process data outside India. When they do, we use providers with strong security commitments, and we transfer data only as Indian law permits.
              </p>
            </Section>

            <Section id="changes" index={11} title="Changes to this policy">
              <p>
                When we change this policy, we&apos;ll update the effective date at the top. For significant changes, we&apos;ll also tell you by email or in your dashboard before they take effect.
              </p>
            </Section>

            <Section id="contact" index={12} title="Contact and grievances">
              <p>Questions, requests or complaints about your data go to our Grievance Officer:</p>
              <div className="flex flex-col gap-4 rounded-2xl bg-[#031713] p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="min-w-0">
                  <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#8fe05f]">Grievance Officer · Reelencer</div>
                  <div className="mt-1.5 break-all text-[17px] font-semibold">{CONTACT_EMAIL}</div>
                  <p className="mt-1 text-[13.5px] leading-6 text-white/65">Use the subject &ldquo;Privacy request&rdquo;. We acknowledge every request and reply as soon as we can.</p>
                </div>
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Privacy request")}`}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#8fe05f] px-5 text-[14px] font-bold text-[#0b1914] transition hover:bg-[#9ae86a]"
                >
                  <Glyph name="mail" className="h-4 w-4" />
                  Email us
                </a>
              </div>
              <p className="text-[13.5px] text-[#5b665f]">
                If you&apos;re not satisfied with our response, you can complain to the Data Protection Board of India.
              </p>
            </Section>
          </article>

          <div className="mt-6 flex max-w-[46rem] flex-col gap-3 px-1 text-[13px] text-[#5b665f] sm:flex-row sm:items-center sm:justify-between print:hidden">
            <span>
              Last updated <time dateTime={EFFECTIVE.iso}>{EFFECTIVE.label}</time>
            </span>
            <a href="#who-we-are" className="font-semibold text-[#1f6b3f] hover:underline">
              Back to top ↑
            </a>
          </div>
        </main>
      </div>
    </div>
  );
}
