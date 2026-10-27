import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REEL_KIT, REEL_KIT_GIG_ID, TAKE_TIMELINE, demoPayoutBatches, demoWalletHref, encodeReelKit, isReelKitGig, parseDemoWallet, parseGigReelKit, parseReelKit, reelKitRequirementsForGig, reelShots, sanitizeReelKit, withReelKit } from "../../lib/reelKit";
import { parseGigBriefAssets, splitBriefMediaLines, withReelExample } from "../../lib/gigBriefMedia";
import { summarizePayoutBatches } from "../../lib/creatorEarnings";

test("reel kit round-trips through the private media list and stays out of reference pictures", () => {
  const picture = "https://media.example.test/wallet.png";
  const kit = { ...DEFAULT_REEL_KIT, paidOut: 2400, steps: ["Film the laptop"] };
  const lines = withReelKit([picture], kit);
  assert.deepEqual(parseReelKit(lines), kit);
  assert.deepEqual(parseReelKit(lines.map((line) => `Media::${line}`)), kit);
  assert.deepEqual(splitBriefMediaLines(lines).assets, [picture]);
  assert.deepEqual(parseGigBriefAssets(lines.map((line) => `Media::${line}`)).map((asset) => asset.url), [picture]);
  // Editing reel examples keeps the kit; removing the kit keeps everything else.
  assert.deepEqual(parseReelKit(withReelExample(lines, picture, "https://media.example.test/reel.mp4")), kit);
  assert.deepEqual(withReelKit(lines, null), [picture]);
});

test("only the saved wallet campaign can render a reel kit, even when another gig copies its settings", () => {
  const configured = { ...DEFAULT_REEL_KIT, approved: 50898.47, paidOut: 29310.2 };
  const requirements = [`Media::${encodeReelKit(configured)}`];
  assert.equal(isReelKitGig(REEL_KIT_GIG_ID), true);
  assert.deepEqual(parseGigReelKit(REEL_KIT_GIG_ID, requirements), configured);
  for (const id of [undefined, null, "", "other-gig", `${REEL_KIT_GIG_ID}-copy`]) {
    assert.equal(isReelKitGig(id), false);
    assert.equal(parseGigReelKit(id, requirements), null);
  }
});

test("removing another gig's copied kit preserves references, examples, notes and their order", () => {
  const normal = ["Brief::Make a reel", "Media::https://media.example.test/reference.png", 'Media::Note::{"for":"https://media.example.test/reference.png","text":"Show this"}', "Sample::https://media.example.test/sample.mp4"];
  const copied = [normal[0], `Media::${encodeReelKit(DEFAULT_REEL_KIT)}`, ...normal.slice(1), `  mEdIa::  kIt::${JSON.stringify(DEFAULT_REEL_KIT)}`, encodeReelKit(DEFAULT_REEL_KIT)];
  assert.deepEqual(reelKitRequirementsForGig("other-gig", copied), normal);
  assert.deepEqual(reelKitRequirementsForGig(REEL_KIT_GIG_ID, copied), copied);
  assert.deepEqual(reelKitRequirementsForGig("other-gig", []), []);
});

test("untrusted kits are clamped and cleaned instead of breaking the creator view", () => {
  assert.equal(sanitizeReelKit({ screen: "bank" }), null);
  assert.equal(parseReelKit(["Media::Kit::{oops"]), null);
  const kit = sanitizeReelKit({ screen: "wallet", approved: "-5", pending: 1e12, approvedReels: 3.6, caption: `  Big   win ${"!".repeat(200)}`, steps: ["", " One ", 7], example: "javascript:alert(1)" })!;
  assert.equal(kit.approved, 0);
  assert.equal(kit.pending, 10_000_000);
  assert.equal(kit.approvedReels, 4);
  assert.equal(kit.caption.length, 120);
  assert.ok(kit.caption.startsWith("Big win !"));
  assert.deepEqual(kit.steps, ["One"]);
  assert.equal("example" in kit, false);
  assert.ok(encodeReelKit(kit).startsWith("Kit::"));
});

test("demo wallet links carry only the figures and a short display name", () => {
  const href = demoWalletHref({ ...DEFAULT_REEL_KIT, paidOut: 1200 }, "  Dank   Singh with a very long surname here ");
  const url = new URL(href, "https://reelencer.test");
  assert.equal(url.pathname, "/reel-kit/wallet");
  const wallet = parseDemoWallet(Object.fromEntries(url.searchParams));
  assert.deepEqual(wallet, { name: "Dank Singh with a very l", approved: 5898.47, approvedReels: 31, pending: 1185.8, pendingReels: 26, paidOut: 1200, pendingWithdrawal: 0 });
  assert.equal(url.searchParams.has("pw"), false);
  assert.deepEqual(parseDemoWallet({ a: ["12", "99"], p: "abc" }), { name: "Creator", approved: 12, approvedReels: 0, pending: 0, pendingReels: 0, paidOut: 0, pendingWithdrawal: 0 });
});

test("demo payout cycles add up exactly to the configured paid and pending figures", () => {
  const now = Date.parse("2026-10-26T04:00:00Z");
  const batches = demoPayoutBatches({ name: "Dank", paidOut: 4171.81, pendingWithdrawal: 650.5 }, now);
  assert.deepEqual(summarizePayoutBatches(batches), { credited: 4171.81, pending: 650.5, liveBatches: 1 });
  assert.equal(batches[0].items[0].handle, "dank");
  assert.deepEqual(demoPayoutBatches({ name: "x", paidOut: 0, pendingWithdrawal: 0 }, now), []);
  assert.deepEqual(summarizePayoutBatches(demoPayoutBatches({ name: "x", paidOut: 1000, pendingWithdrawal: 0 }, now, 0.5)).credited, 500);
});

test("the shot list follows the sample reel and uses the kit's captions, falling back to the defaults", () => {
  const shots = reelShots({ hook: "My hook", caption: "My close" });
  assert.deepEqual(shots.map((shot) => shot.id), ["hook", "chrome", "search", "account", "apply", "proposal", "wallet"]);
  assert.equal(shots[0].caption, "My hook");
  assert.equal(shots[0].camera, "selfie");
  assert.equal(shots.at(-1)!.caption, "My close");
  const defaults = reelShots({ hook: "", caption: "" });
  assert.equal(defaults[0].caption, DEFAULT_REEL_KIT.hook);
  assert.equal(defaults.at(-1)!.caption, DEFAULT_REEL_KIT.caption);
  assert.ok(shots.slice(1).every((shot) => shot.camera === "screen" && shot.placement === "lower"));
});

test("every scroll flick of a take finishes before the pointer heads to the payout cycle", () => {
  for (const [offset, duration] of TAKE_TIMELINE.flicks) assert.ok(TAKE_TIMELINE.scrollAtMs + offset + duration <= TAKE_TIMELINE.openAtMs);
  assert.ok(TAKE_TIMELINE.openAtMs + TAKE_TIMELINE.clickDelayMs < TAKE_TIMELINE.endMs);
});
