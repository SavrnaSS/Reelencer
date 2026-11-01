import test from "node:test";
import assert from "node:assert/strict";
import { broadcastLink, broadcastTemplate, isPromotional, renderBroadcast } from "@/lib/broadcastEmail";

const site = "https://reelencer.com";
const gig = { id: "gig-1", title: "Reaction reels", company: "Parakeet Ai", payout: "₹49", payoutType: "Per 1k Views", platform: "Instagram" };

test("each kind starts from its own template; a promotion links to the gig", () => {
  assert.match(broadcastTemplate("terms").ctaUrl ?? "", /\/terms$/);
  const promo = broadcastTemplate("promotion", gig);
  assert.equal(promo.subject, "New gig: Reaction reels by Parakeet Ai");
  assert.match(promo.ctaUrl ?? "", /gigId=gig-1/);
  assert.equal(isPromotional("terms"), false);
  assert.equal(isPromotional("announcement"), true);
});

test("emails are personalised, link only to http(s), and promotions carry the unsubscribe link", () => {
  const promo = { ...broadcastTemplate("promotion", gig), gig } as Parameters<typeof renderBroadcast>[0];
  const email = renderBroadcast({ ...promo, subject: "{first_name}, a gig for you" }, { name: "Priya Sharma" }, { siteUrl: site, unsubscribeUrl: `${site}/api/email/unsubscribe?e=x&t=y` });
  assert.equal(email.subject, "Priya, a gig for you");
  assert.match(email.text, /Hi Priya/);
  assert.match(email.text, /Unsubscribe: https:\/\/reelencer\.com\/api\/email\/unsubscribe/);
  assert.match(email.text, /Per 1k Views/);
  const terms = renderBroadcast(broadcastTemplate("terms") as Parameters<typeof renderBroadcast>[0], { name: "" }, { siteUrl: site });
  assert.match(terms.text, /Hi there/);
  assert.doesNotMatch(terms.text, /Unsubscribe/);
  assert.equal(broadcastLink("/terms", site), "https://reelencer.com/terms");
  assert.equal(broadcastLink("javascript:alert(1)", site), null);
  assert.equal(broadcastLink("", site), null);
});

test("follow-ups are personalised with each person's gig, handle, code and own gig link", async () => {
  const { followUpTemplate, fillTokens, hasFollowUp } = await import("@/lib/broadcastEmail");
  const email = renderBroadcast(followUpTemplate("code"), { name: "Sakshi Singh", vars: { gig_title: "Reaction reels", company: "Parakeet Ai", handle: "sakshi_singh_8941", code: "RL-LG5UGV", gig_link: `${site}/dashboard?section=find&gigId=gig-1#account-setup` } }, { siteUrl: site });
  assert.equal(email.subject, "Add RL-LG5UGV to @sakshi_singh_8941's bio");
  assert.match(email.text, /Hi Sakshi, we checked @sakshi_singh_8941 for Reaction reels/);
  assert.match(email.html, /gigId=gig-1#account-setup/);
  assert.doesNotMatch(email.text, /Unsubscribe/, "Follow-ups are about the person's own application, not promotions");
  // Missing details read naturally, and a gig link falls back to the gigs page.
  const bare = renderBroadcast(followUpTemplate("no_username"), { name: "" }, { siteUrl: site });
  assert.equal(bare.subject, "One step left for your gig");
  assert.match(bare.text, /Hi there, you applied to your gig/);
  assert.match(bare.html, /section=find/);
  assert.equal(fillTokens("Check @{handle} now", "", {}), "Check your account now");
  assert.equal(hasFollowUp("awaiting"), true);
  assert.equal(hasFollowUp("unknown"), false);
});
