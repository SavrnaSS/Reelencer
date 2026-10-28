import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL, legalPartyLabel } from "@/lib/legal";
import { publicPageMetadata } from "@/lib/site";
import { Bullets, ContactCard, Glyph, LegalPage, MailLink, Note, Section, type IconName } from "@/app/_components/legal/LegalPage";

export const metadata: Metadata = publicPageMetadata({
  title: "Terms of Service",
  description: "The rules for using Reelencer as a creator: applying to gigs, posting from linked accounts, how earnings are reviewed and paid, identity verification and account suspension.",
  path: "/terms",
});

// Keep the effective date in step with any change to these terms.
const EFFECTIVE = { iso: "2026-09-28", label: "28 September 2026" };

const SECTIONS = [
  { id: "agreement", title: "Agreeing to these terms" },
  { id: "your-account", title: "Your account" },
  { id: "gigs", title: "How gigs work" },
  { id: "payments", title: "Payment terms" },
  { id: "verification", title: "Identity verification" },
  { id: "acceptable-use", title: "Rules you agree to follow" },
  { id: "your-content", title: "Your content" },
  { id: "platforms", title: "Instagram and other platforms" },
  { id: "suspension", title: "Suspension and closing your account" },
  { id: "disclaimers", title: "Disclaimers" },
  { id: "liability", title: "Limits on liability" },
  { id: "changes", title: "Changes to these terms" },
  { id: "law", title: "Governing law and disputes" },
  { id: "contact", title: "Contact us" },
];

const HIGHLIGHTS: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: "coin", title: "Paid for approved work", body: "Request a payout to your UPI once you have ₹1,000 approved." },
  { icon: "check", title: "Real views only", body: "Views are reviewed. Bought or bot views are excluded from pay." },
  { icon: "film", title: "Your content stays yours", body: "You keep ownership and give us a licence to use it for the gig." },
  { icon: "trash", title: "Leave any time", body: "Close your account whenever you like, with a 7-day restore window." },
];

const STEPS: Array<[string, string]> = [
  ["Apply", "Choose an open gig and apply, with a proposal or quote if the gig asks for one."],
  ["Get approved", "The Reelencer team reviews every application and decides whether to approve it. We can decline any application."],
  ["Do the work", "Follow the gig's brief. For posting gigs, post from the account you verified for that gig and submit each reel's link."],
  ["Get reviewed and paid", "We review what you submit. Approved work earns at the gig's rate, and you request payouts to your UPI ID."],
];

const NOT_ALLOWED: Array<{ icon: IconName; text: string }> = [
  { icon: "ban", text: "Buying views, likes or followers, or using bots, view farms, engagement groups or anything else that inflates numbers." },
  { icon: "film", text: "Submitting content you didn't create or don't have the rights to, or reposting someone else's work as your own." },
  { icon: "people", text: "Impersonating anyone, using someone else's identity documents, or running accounts to get around a limit, rejection or suspension." },
  { icon: "alert", text: "Content that is illegal, hateful, sexually explicit, misleading or harmful, or that breaks a platform's rules." },
  { icon: "lock", text: "Trying to access other people's data, probing or disrupting our systems, or getting around security checks." },
  { icon: "flag", text: "Hiding that a post is paid. Label sponsored content the way the platform and Indian advertising guidelines require." },
];

export default function TermsPage() {
  return (
    <LegalPage
      path="/terms"
      title="Terms of Service"
      intro="The agreement between you and Reelencer when you use the platform to find gigs, post content and get paid. Please read it before you start."
      effective={EFFECTIVE}
      chips={[{ icon: "scale", label: "Governed by the laws of India" }, { label: "About 11 minutes to read" }]}
      highlights={HIGHLIGHTS}
      sections={SECTIONS}
    >
      <Section id="agreement" index={0} title="Agreeing to these terms">
        <p>
          These terms are an agreement between you and {legalPartyLabel()}. They apply when you create an account, apply to a gig or use any part of our website and creator dashboard.
        </p>
        <p>
          By creating an account, you confirm that you are <strong>at least 18 years old</strong>, that you can enter a binding contract, and that you accept these terms and our{" "}
          <Link href="/privacy" className="font-semibold text-[#1f6b3f] underline decoration-[#9fcfae] underline-offset-4 hover:decoration-[#1f6b3f]">
            Privacy Policy
          </Link>
          . If you don&apos;t agree, please don&apos;t use Reelencer.
        </p>
        <p>
          You use Reelencer as an <strong>independent creator</strong>. Nothing in these terms makes you our employee, partner or agent.
        </p>
      </Section>

      <Section id="your-account" index={1} title="Your account">
        <Bullets
          items={[
            "Give accurate information and keep it up to date, especially your name, email and payment details.",
            "Keep your password private. You're responsible for everything done from your account.",
            "Tell us straight away at support@reelencer.com if you think someone else has used your account.",
            "Accounts are personal. Don't sell, share or transfer yours.",
          ]}
        />
      </Section>

      <Section id="gigs" index={2} title="How gigs work">
        <ol className="grid gap-3 sm:grid-cols-2">
          {STEPS.map(([title, body], index) => (
            <li key={title} className="flex gap-3.5 rounded-xl border border-[#e6e9e5] bg-[#fbfcfa] p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#14201a] text-[12px] font-semibold text-white">{index + 1}</span>
              <span className="min-w-0">
                <span className="block font-semibold text-[#14201a]">{title}</span>
                <span className="block text-[14px] leading-6 text-[#4b544e]">{body}</span>
              </span>
            </li>
          ))}
        </ol>
        <p>
          <strong>Posting gigs:</strong> you must link and verify the account you&apos;ll post from, by adding the code we give you to its bio. You can use a new account or one you already run, as long as it&apos;s public and you control it.
        </p>
        <p>
          <strong>Account creation gigs:</strong> some gigs ask you to create accounts and hand them over. Only create accounts in the way the brief describes and the platform&apos;s rules allow, and give us accurate details for them.
        </p>
        <p>Approval doesn&apos;t guarantee a number of posts, views or a level of income. Gig details, including rates, can change for work you haven&apos;t submitted yet.</p>
      </Section>

      <Section id="payments" index={3} title="Payment terms">
        <p>This section explains how you earn, how earnings are reviewed and how they reach you. All amounts are in Indian rupees (₹).</p>

        <h3 className="pt-2 text-[16px] font-semibold text-[#14201a]">How you earn</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[#e6e9e5] bg-[#fbfcfa] p-4">
            <div className="text-[13.5px] font-semibold text-[#14201a]">Per 1,000 views</div>
            <p className="mt-1 text-[13.5px] leading-6 text-[#4b544e]">
              For posting gigs, you earn the gig&apos;s rate for every 1,000 genuine views on your <strong>approved</strong> reels. Views are measured on the linked account and each view is paid only once.
            </p>
            <p className="mt-2 rounded-lg bg-white px-3 py-2 text-[12.5px] leading-5 text-[#5b665f] ring-1 ring-[#e6e9e5]">
              Example: at ₹49 per 1,000 views, 20,000 new views earn ₹980.
            </p>
          </div>
          <div className="rounded-xl border border-[#e6e9e5] bg-[#fbfcfa] p-4">
            <div className="text-[13.5px] font-semibold text-[#14201a]">Per task</div>
            <p className="mt-1 text-[13.5px] leading-6 text-[#4b544e]">
              For task gigs, you earn the fixed amount shown on the gig when the work you submit is approved. Work sent back for changes earns once it&apos;s approved.
            </p>
          </div>
        </div>
        <p className="text-[14px] leading-6 text-[#5b665f]">Earnings figures on your dashboard are estimates until they&apos;re reviewed. Only approved amounts can be paid out.</p>

        <h3 className="pt-2 text-[16px] font-semibold text-[#14201a]">Claiming view earnings</h3>
        <p>
          When your approved reels gain new views, you can claim them from Linked. A claim covers the views added since your last claim and is reviewed by our team. You can have one open claim per account at a time.
        </p>
        <div className="overflow-hidden rounded-xl border border-[#e6e9e5]">
          <ul className="divide-y divide-[#eceee9]">
            {[
              ["Approved", "text-[#24613a] bg-[#e7f3ea]", "The claim's amount is added to your approved earnings."],
              ["Partly approved", "text-[#8a5a12] bg-[#fbf1dc]", "Views we find inorganic are excluded with a recorded reason. The rest is approved."],
              ["Rejected", "text-[#5b665f] bg-[#eef1ed]", "Nothing is credited this time, and we give a reason. Those views can be claimed again once the issue is fixed."],
              ["Hard rejected", "text-[#9a3b2f] bg-[#fbe9e6]", "Used for fake or manipulated views. Those views are never paid."],
            ].map(([label, tone, body]) => (
              <li key={label} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                <span className={`w-fit shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold sm:w-32 sm:text-center ${tone}`}>{label}</span>
                <span className="min-w-0 text-[13.5px] leading-6 text-[#4b544e]">{body}</span>
              </li>
            ))}
          </ul>
        </div>

        <h3 className="pt-2 text-[16px] font-semibold text-[#14201a]">Getting paid</h3>
        <ol className="grid gap-2.5 sm:grid-cols-2 sm:gap-3">
          {[
            ["Approved earnings", "Approved work and approved view claims add up in Payouts."],
            ["Request a payout", "Once you have at least ₹1,000 approved, request a payout from Payouts."],
            ["Processing", "Our team checks the request against your verified details and sends the payment."],
            ["Paid", "The money is sent to your UPI ID and the payout is marked paid with its payment reference."],
          ].map(([title, body], index) => (
            <li key={title} className="flex gap-3 rounded-xl border border-[#e6e9e5] bg-[#fbfcfa] p-3.5 sm:p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2e7d4f] text-[12px] font-semibold text-white">{index + 1}</span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-[#14201a]">{title}</span>
                <span className="mt-0.5 block text-[13px] leading-[1.35rem] text-[#4b544e]">{body}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="rounded-xl border border-[#d8e8dc] bg-[#f3f9f4] p-4">
          <div className="text-[13.5px] font-semibold text-[#173d2a]">To request a payout, you need:</div>
          <ul className="mt-2 grid gap-1.5 text-[13.5px] leading-6 text-[#2c4a37] sm:grid-cols-2">
            {["At least ₹1,000 in approved earnings", "Approved identity verification (KYC)", "A UPI ID verified by our team", "No other payout already in progress"].map((item) => (
              <li key={item} className="flex gap-2">
                <Glyph name="check" className="mt-[3px] h-4 w-4 shrink-0 text-[#2e7d4f]" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <Bullets
          items={[
            <><strong>Payout schedule:</strong> choose weekly (on a weekday) or monthly (on a day from the 1st to the 28th) in Payouts. We process requests in line with your schedule, but timing can vary with reviews and bank or UPI delays.</>,
            <><strong>Your UPI ID:</strong> payouts go to the UPI ID verified when you made the request. A new UPI ID has to be verified again before it can be paid. We aren&apos;t responsible for payments sent to a UPI ID you gave us that turns out to be wrong.</>,
            <><strong>Failed payments:</strong> if a payment fails, for example because the UPI ID can&apos;t receive it, the amount returns to your approved earnings and you can request it again.</>,
            <><strong>Charges:</strong> any charges your bank or UPI app applies are outside our control.</>,
          ]}
        />

        <h3 className="pt-2 text-[16px] font-semibold text-[#14201a]">Holds, corrections and taxes</h3>
        <Bullets
          items={[
            <>We can <strong>hold</strong> earnings or a payout while we look into suspected fraud, fake views or a breach of these terms, and cancel earnings that come from them.</>,
            <>If we pay you by mistake, or for work later found to break these terms, we can <strong>recover</strong> the amount, including by deducting it from future earnings.</>,
            <>You&apos;re responsible for your own <strong>taxes</strong> on what you earn. Where the law requires us to deduct tax at source, we&apos;ll deduct it and show it with your payout.</>,
            <>Earnings are tied to the account they were earned on and can&apos;t be transferred to another person.</>,
          ]}
        />
        <Note>If you think a review, claim or payout is wrong, email us within 30 days of the decision with the gig and the amount, and we&apos;ll take another look.</Note>
      </Section>

      <Section id="verification" index={4} title="Identity verification">
        <p>
          To protect creators and brands from fraud, we verify who we pay. You&apos;ll be asked for your legal details, an identity document and a live selfie taken in the page.
        </p>
        <Bullets
          items={[
            "Use only your own, genuine documents. Edited, borrowed or fake documents can lead to a permanent ban.",
            "We may ask you to verify again, or refuse verification if we can't confirm your identity.",
            "Until verification is approved, earnings stay in your account and aren't paid out.",
          ]}
        />
        <p>
          How we handle this information is explained in our{" "}
          <Link href="/privacy#what-we-collect" className="font-semibold text-[#1f6b3f] underline decoration-[#9fcfae] underline-offset-4 hover:decoration-[#1f6b3f]">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      <Section id="acceptable-use" index={5} title="Rules you agree to follow">
        <p>To keep Reelencer fair for everyone, you agree <strong>not</strong> to:</p>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {NOT_ALLOWED.map((rule) => (
            <li key={rule.text} className="flex gap-3 rounded-xl border border-[#f0dfd9] bg-[#fdf8f6] p-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#a2493b] ring-1 ring-[#f0dfd9]">
                <Glyph name={rule.icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0 text-[13.5px] leading-6 text-[#4b3a35]">{rule.text}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="your-content" index={6} title="Your content">
        <p>
          You keep ownership of the content you create. When you submit content for a gig, you give Reelencer and the brand behind that gig a <strong>non-exclusive, worldwide, royalty-free licence</strong> to use, copy, edit for length or format, publish and share it for the gig and to promote it.
        </p>
        <p>
          You confirm that you have the rights to everything in your content, including music, footage, logos and the people who appear in it, and that it doesn&apos;t infringe anyone else&apos;s rights.
        </p>
        <p>Reference pictures, demo screens and briefs we give you are ours or the brand&apos;s. Use them only for the gig.</p>
      </Section>

      <Section id="platforms" index={7} title="Instagram and other platforms">
        <p>
          Reelencer isn&apos;t affiliated with or endorsed by Instagram, Meta, YouTube, Google or any other platform you post on. You must follow each platform&apos;s own terms and community guidelines.
        </p>
        <p>
          Platforms can change their features, limit reach, remove posts or close accounts. We aren&apos;t responsible for their decisions, and views lost to them can&apos;t be paid.
        </p>
      </Section>

      <Section id="suspension" index={8} title="Suspension and closing your account">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[#e6e9e5] bg-[#fbfcfa] p-4">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#14201a]">
              <Glyph name="pause" className="h-4 w-4 text-[#a2493b]" />
              If you break these terms
            </div>
            <p className="mt-1.5 text-[13.5px] leading-6 text-[#4b544e]">
              We may reject submissions, hold earnings, suspend your account or block access from connections linked to abuse. For serious or repeated breaches, we may close the account permanently.
            </p>
          </div>
          <div className="rounded-xl border border-[#e6e9e5] bg-[#fbfcfa] p-4">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#14201a]">
              <Glyph name="trash" className="h-4 w-4 text-[#2e7d4f]" />
              If you want to leave
            </div>
            <p className="mt-1.5 text-[13.5px] leading-6 text-[#4b544e]">
              Ask us to delete your account at any time. Access stops at once and your data is permanently removed after a 7-day restore window. Ask about any approved earnings before you leave.
            </p>
          </div>
        </div>
        <p>When we suspend or close an account, we&apos;ll tell you why unless the law or an investigation prevents it, and you can reply to ask us to review the decision.</p>
      </Section>

      <Section id="disclaimers" index={9} title="Disclaimers">
        <p>
          Reelencer is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>. We work to keep it running and accurate, but we don&apos;t promise it will be uninterrupted or error-free, that a gig will be available to you, or that you&apos;ll earn a particular amount.
        </p>
        <p>View counts, earnings estimates and analytics on your dashboard are estimates until work is reviewed. The reviewed and approved amounts are what count.</p>
      </Section>

      <Section id="liability" index={10} title="Limits on liability">
        <p>
          To the extent the law allows, Reelencer isn&apos;t liable for indirect or consequential losses, such as lost profits, lost followers or loss of data, arising from your use of the platform.
        </p>
        <p>
          Our total liability to you for any claim is limited to the approved earnings we owe you at the time of the claim. Nothing in these terms limits liability that can&apos;t be limited under Indian law.
        </p>
        <p>You agree to cover any loss Reelencer or a brand suffers because you broke these terms or infringed someone&apos;s rights.</p>
      </Section>

      <Section id="changes" index={11} title="Changes to these terms">
        <p>
          We may update these terms as Reelencer changes. We&apos;ll update the effective date above and, for significant changes, tell you by email or in your dashboard before they take effect. If you keep using Reelencer after that, the new terms apply.
        </p>
      </Section>

      <Section id="law" index={12} title="Governing law and disputes">
        <p>These terms are governed by the laws of India.</p>
        <p>
          If something goes wrong, contact us first. Most issues are solved quickly that way. If we can&apos;t resolve a dispute together within 30 days, {LEGAL.courtCity ? `the courts at ${LEGAL.courtCity}, India will have exclusive jurisdiction over it.` : "it will be handled by the competent courts in India."}
        </p>
      </Section>

      <Section id="contact" index={13} title="Contact us">
        <p>Questions about these terms, a review you disagree with or a payout issue? Write to us:</p>
        <ContactCard eyebrow="Reelencer support" subject="Terms question" note="Include your worker ID and the gig, if it's about a specific job. We reply as soon as we can." />
        <p className="text-[13.5px] text-[#5b665f]">
          For privacy requests, email <MailLink subject="Privacy request" /> with the subject &ldquo;Privacy request&rdquo;.
        </p>
      </Section>
    </LegalPage>
  );
}
