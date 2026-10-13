import test from "node:test";
import assert from "node:assert/strict";
import { CREATOR_HOME_HREF, findGigHref, legacyGigDestination } from "../../lib/routes";

test("gig details and application links encode IDs inside the dashboard", () => {
  const id = "campaign & reel/1";
  const details = new URL(findGigHref(id), "https://reelencer.example");
  assert.equal(details.pathname, "/dashboard");
  assert.equal(details.searchParams.get("section"), "find");
  assert.equal(details.searchParams.get("gigId"), id);
  assert.equal(details.searchParams.has("intent"), false);
  assert.equal(new URL(findGigHref(id, "apply"), details).searchParams.get("intent"), "apply");
});

test("retired gig links preserve their gig and application intent without trusting type hints", () => {
  assert.equal(legacyGigDestination({ gigId: "reel-49", gigType: "project" }), findGigHref("reel-49"));
  assert.equal(legacyGigDestination({ gigid: " reel-49 ", intent: "apply" }), findGigHref("reel-49", "apply"));
  assert.equal(legacyGigDestination({ gigId: ["reel-49", "another"], intent: ["apply", "details"] }), findGigHref("reel-49", "apply"));
});

test("missing legacy gigs return to Jobs and redirect parameters cannot leave the app", () => {
  assert.equal(legacyGigDestination({}), CREATOR_HOME_HREF);
  assert.equal(legacyGigDestination({ gigId: " ", gigType: "email-creator" }), CREATOR_HOME_HREF);
  assert.equal(legacyGigDestination({ gigId: "x".repeat(101) }), CREATOR_HOME_HREF);
  const target = new URL(legacyGigDestination({ gigId: "reel-49", intent: "external", next: "https://outside.example" }), "https://reelencer.example");
  assert.equal(target.origin, "https://reelencer.example");
  assert.equal(target.pathname, "/dashboard");
  assert.equal(target.searchParams.has("next"), false);
  assert.equal(target.searchParams.has("intent"), false);
});
