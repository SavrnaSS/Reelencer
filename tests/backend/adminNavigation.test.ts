import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_NAV_GROUPS,
  adminSectionHref,
  isGigAdminSection,
  legacyGigAdminHref,
  parseAdminSection,
  type AdminSection,
  type GigAdminView,
} from "../../lib/adminNavigation";

const gigViews: GigAdminView[] = [
  "create-new-gig", "gig-listings", "applications", "kyc-review", "credential-submissions", "linked-accounts",
];

test("every admin destination has a unique URL and all gig pages belong to Operations", () => {
  const items = ADMIN_NAV_GROUPS.flatMap((group) => group.items);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  assert.equal(new Set(items.map((item) => adminSectionHref(item.id))).size, items.length);
  const operations = ADMIN_NAV_GROUPS.find((group) => group.label === "Operations")!.items;
  assert.deepEqual(operations.filter((item) => isGigAdminSection(item.id)).map((item) => item.id), gigViews);
  for (const item of items) {
    assert.equal(parseAdminSection(new URL(adminSectionHref(item.id), "https://example.test").searchParams), item.id);
  }
});

test("section parsing retains previous labels and falls back safely for unknown sections", () => {
  const oldSections: AdminSection[] = ["Overview", "Reviews", "Work", "Assignments", "Workers", "Payouts", "Feedback", "Email Access"];
  for (const section of oldSections) assert.equal(parseAdminSection(new URLSearchParams({ section })), section);
  assert.equal(parseAdminSection("?section=Gigs"), "gig-listings");
  assert.equal(parseAdminSection("?section=%20APPLICATIONS%20"), "applications");
  assert.equal(parseAdminSection("?section=work-items"), "Overview");
  assert.equal(parseAdminSection("?section=https%3A%2F%2Fexample.test"), "Overview");
  assert.equal(parseAdminSection("?section=constructor"), "Overview");
  assert.equal(parseAdminSection(), "Overview");
  assert.equal(parseAdminSection(null), "Overview");
  assert.equal(parseAdminSection("?gig=GIG-1"), "Overview");
});

test("legacy gig URLs preserve encoded filters and repeated parameters while enforcing their destination", () => {
  for (const view of gigViews) {
    const target = new URL(legacyGigAdminHref(view, {
      gig: "GIG /?&=+é",
      edit: "GIG-edit",
      section: ["Overview", "linked-accounts"],
      tag: ["one", "two"],
      empty: "",
      absent: undefined,
    }), "https://example.test");
    assert.equal(target.pathname, "/admin");
    assert.equal(target.searchParams.get("gig"), "GIG /?&=+é");
    assert.equal(target.searchParams.get("edit"), "GIG-edit");
    assert.deepEqual(target.searchParams.getAll("section"), [view]);
    assert.deepEqual(target.searchParams.getAll("tag"), ["one", "two"]);
    assert.equal(target.searchParams.get("empty"), "");
    assert.equal(target.searchParams.has("absent"), false);
  }
});

test("navigation preserves caller parameters without mutating inputs", () => {
  const params = new URLSearchParams("section=overview&gig=GIG-123");
  const target = new URL(adminSectionHref("applications", params), "https://example.test");
  assert.equal(target.searchParams.get("section"), "applications");
  assert.equal(target.searchParams.get("gig"), "GIG-123");
  assert.equal(params.toString(), "section=overview&gig=GIG-123");
  assert.equal(adminSectionHref("Email Access"), "/admin?section=email-access");
  assert.equal(adminSectionHref("Work", "?section=overview&edit=GIG-1"), "/admin?section=work&edit=GIG-1");
});

test("only the six gig views use the embedded gig console", () => {
  for (const view of gigViews) assert.equal(isGigAdminSection(view), true);
  for (const section of ["Overview", "Work", "Workers", "Email Access"] as AdminSection[]) {
    assert.equal(isGigAdminSection(section), false);
  }
});
