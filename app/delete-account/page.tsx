import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/site";
import { Bullets, ContactCard, LegalPage, Note, Section, type IconName } from "@/app/_components/legal/LegalPage";

// The public account-deletion page Google Play links to from the app's store listing (Data safety → account
// deletion URL). It must work for people who no longer have the app, so the email route needs no sign-in.
export const metadata: Metadata = publicPageMetadata({
  title: "Delete your Reelencer account",
  description: "How to delete your Reelencer creator account and data from the Android app, the website or by email, and what is kept for legal reasons.",
  path: "/delete-account",
});

const EFFECTIVE = { iso: "2026-11-12", label: "12 November 2026" };

const SECTIONS = [
  { id: "in-the-app", title: "Delete it in the Android app" },
  { id: "without-the-app", title: "Delete it without the app" },
  { id: "what-happens", title: "What happens next" },
  { id: "what-we-keep", title: "What we keep, and for how long" },
  { id: "contact", title: "Contact us" },
];

const HIGHLIGHTS: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: "trash", title: "Starts straight away", body: "Access stops the moment you confirm." },
  { icon: "lock", title: "7 days to change your mind", body: "Email us within 7 days and we can restore the account." },
  { icon: "check", title: "Then permanently erased", body: "Profile, linked accounts, files and sign-in access are removed." },
];

export default function DeleteAccountPage() {
  return (
    <LegalPage
      path="/delete-account"
      title="Delete your account"
      intro="You can delete your Reelencer creator account and the data that comes with it at any time. Here's how, and exactly what happens."
      effective={EFFECTIVE}
      chips={[{ label: "About 2 minutes to read" }]}
      highlights={HIGHLIGHTS}
      sections={SECTIONS}
    >
      <Section id="in-the-app" index={0} title="Delete it in the Android app">
        <Bullets
          items={[
            "Open the Reelencer app and sign in.",
            <>Tap your <strong>profile picture</strong> (top right), then <strong>Delete account</strong>.</>,
            <>Read what will be removed, type <strong>DELETE</strong> and confirm.</>,
          ]}
        />
      </Section>

      <Section id="without-the-app" index={1} title="Delete it without the app">
        <p>
          Email <strong>support@reelencer.com</strong> from the address you signed up with, with the subject &ldquo;Delete my account&rdquo;. We confirm it&apos;s you and
          delete the account within 7 days. You don&apos;t need the app or a password for this.
        </p>
      </Section>

      <Section id="what-happens" index={2} title="What happens next">
        <Bullets
          items={[
            "Access stops straight away: the app and the website no longer work for this account.",
            "For 7 days the account can still be restored if you email us. After that, it's permanently erased and can't be recovered.",
          ]}
        />
        <Note>Request a payout of any approved balance before deleting. Money still in your wallet can&apos;t be paid out after the account is erased.</Note>
      </Section>

      <Section id="what-we-keep" index={3} title="What we keep, and for how long">
        <p>
          After the 7-day window we erase your profile, contact details, linked accounts, uploaded files and identity documents. We keep only what Indian law requires,
          such as payout and tax records, for the period the law sets, and nothing else. See the{" "}
          <Link href="/privacy" className="font-semibold text-[#1f6b3f] underline decoration-[#9fcfae] underline-offset-4 hover:decoration-[#1f6b3f]">Privacy Policy</Link>{" "}
          for details.
        </p>
      </Section>

      <Section id="contact" index={4} title="Contact us">
        <ContactCard eyebrow="Account deletion" note="Questions about deleting your account or data" subject="Delete my account" />
      </Section>
    </LegalPage>
  );
}
