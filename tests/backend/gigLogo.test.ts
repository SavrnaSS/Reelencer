import test from "node:test";
import assert from "node:assert/strict";
import { gigLogoUrl, usableLogoUrl, withGigLogo } from "@/lib/gigLogo";

const logo = "https://cdn.example.test/logos/parakeet.png";

test("a gig's logo is read from its settings and only https addresses are shown", () => {
  assert.equal(gigLogoUrl(["Brief::Hi", `Meta::company_logo=${logo}`]), logo);
  assert.equal(gigLogoUrl(["Brief::Hi"]), null);
  assert.equal(gigLogoUrl(null), null);
  assert.equal(usableLogoUrl("http://cdn.example.test/a.png"), null);
  assert.equal(usableLogoUrl("javascript:alert(1)"), null);
  assert.equal(usableLogoUrl("not a url"), null);
});

test("setting, replacing and removing a logo keeps every other setting", () => {
  const lines = ["Brief::Hi", "Meta::kyc_required=true"];
  const added = withGigLogo(lines, logo);
  assert.deepEqual(added, [...lines, `Meta::company_logo=${logo}`]);
  const replaced = withGigLogo(added, "https://cdn.example.test/logos/new.webp");
  assert.equal(gigLogoUrl(replaced), "https://cdn.example.test/logos/new.webp");
  assert.equal(replaced.filter((line) => line.startsWith("Meta::company_logo=")).length, 1);
  assert.deepEqual(withGigLogo(added, ""), lines);
  assert.deepEqual(withGigLogo(lines, "http://insecure.test/x.png"), lines);
});
