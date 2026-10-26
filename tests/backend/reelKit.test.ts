import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REEL_KIT, DEFAULT_WALLET_STEPS, TAKE_TIMELINE, demoPayoutBatches, takeSeconds, takeScenes, demoWalletHref, encodeReelKit, parseDemoWallet, parseReelKit, reelKitSteps, sanitizeReelKit, withReelKit } from "../../lib/reelKit";
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
  assert.deepEqual(reelKitSteps(kit), ["One"]);
  assert.deepEqual(reelKitSteps({ ...kit, steps: [] }), DEFAULT_WALLET_STEPS);
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

test("the storyboard follows the recording screen's timeline without gaps", () => {
  for (const scroll of [true, false]) {
    const scenes = takeScenes({ scroll });
    assert.equal(scenes[0].fromMs, 0);
    assert.equal(scenes.at(-1)!.toMs, TAKE_TIMELINE.endMs);
    scenes.slice(1).forEach((scene, index) => assert.equal(scene.fromMs, scenes[index].toMs));
    assert.equal(scenes.length, scroll ? 4 : 3);
  }
  assert.deepEqual([0, 1800, 2450, 6500].map(takeSeconds), ["0", "1.8", "2.5", "6.5"]);
});
