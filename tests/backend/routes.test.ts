import test from "node:test";
import assert from "node:assert/strict";
import { CREATOR_HOME_HREF, dashboardLocation, findGigHref, legacyGigDestination } from "../../lib/routes";

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

test("the initial dashboard view follows the requested section instead of defaulting to Jobs", () => {
  for (const section of ["profile", "dashboard", "jobs", "find", "accounts", "messages", "wallet"]) {
    assert.deepEqual(dashboardLocation(`section=${section}`), { section, gigId: null, intent: "details" });
  }
  assert.equal(dashboardLocation("").section, "jobs");
  assert.equal(dashboardLocation("section=unknown").section, "jobs");
  assert.equal(dashboardLocation("view=wallet").section, "wallet");
});

test("deep links resolve the exact gig and application intent before data becomes available", () => {
  assert.deepEqual(dashboardLocation("section=find&gigId=reaction-video"), { section: "find", gigId: "reaction-video", intent: "details" });
  assert.deepEqual(dashboardLocation("section=jobs&gigId=reaction-video&intent=apply"), { section: "find", gigId: "reaction-video", intent: "apply" });
  assert.deepEqual(dashboardLocation("view=find&gigid=%20reaction-video%20"), { section: "find", gigId: "reaction-video", intent: "details" });
  assert.deepEqual(dashboardLocation("section=find&gigId=video&intent=external"), { section: "find", gigId: "video", intent: "details" });
  assert.equal(dashboardLocation(`section=find&gigId=${"x".repeat(101)}`).gigId, null);
});
