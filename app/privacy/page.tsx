import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { Bullets, ContactCard, Glyph, LegalPage, MailLink, Note, Section, type IconName } from "@/app/_components/legal/LegalPage";

export const metadata: Metadata = publicPageMetadata({
  title: "Privacy Policy",
  description: "How Reelencer collects, uses, shares and protects creator data, including identity verification, linked social accounts and payouts, and how to exercise your privacy rights.",
  path: "/privacy",
});

// Keep the effective date in step with any change to what the policy describes.
const EFFECTIVE = { iso: "2026-10-28", label: "28 October 2026" };

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

export default function PrivacyPage() {
  return (
    <LegalPage
      path="/privacy"
      title="Privacy Policy"
      intro="What we collect when you use Reelencer, why we need it, who sees it and the control you have over it, in plain language."
      effective={EFFECTIVE}
      chips={[{ icon: "shield", label: "Written for India's DPDP Act, 2023" }, { label: "About 8 minutes to read" }]}
      highlights={HIGHLIGHTS}
      sections={SECTIONS}
    >
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
          To use any of these rights, email <MailLink subject="Privacy request" /> from the address on your account. We&apos;ll confirm it&apos;s you, then respond as soon as we can and within the time the law allows.
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
        <ContactCard eyebrow="Grievance Officer · Reelencer" subject="Privacy request" note="Use the subject “Privacy request”. We acknowledge every request and reply as soon as we can." />
        <p className="text-[13.5px] text-[#5b665f]">
          If you&apos;re not satisfied with our response, you can complain to the Data Protection Board of India.
        </p>
      </Section>
    </LegalPage>
  );
}
