import test from "node:test";
import assert from "node:assert/strict";

const KEYS = ["LEGAL_ENTITY_NAME", "LEGAL_ADDRESS", "LEGAL_GRIEVANCE_OFFICER", "LEGAL_COURT_CITY"] as const;

async function load(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  // A fresh module instance per case, since the details are read once at import.
  return import(`../../lib/legal.ts?case=${Math.random()}`) as Promise<typeof import("../../lib/legal")>;
}

test("legal pages name Reelencer when no business details are set", async () => {
  const { LEGAL, legalPartyLabel } = await load({});
  assert.equal(LEGAL.entity, "Reelencer");
  assert.equal(LEGAL.address, "");
  assert.equal(LEGAL.courtCity, "");
  assert.equal(legalPartyLabel(), "Reelencer (“we”, “us”)");
});

test("legal pages use the registered name and address once set", async () => {
  const { LEGAL, legalPartyLabel } = await load({ LEGAL_ENTITY_NAME: "  Reelencer Technologies Private Limited ", LEGAL_ADDRESS: "12 MG Road, Bengaluru 560001", LEGAL_GRIEVANCE_OFFICER: "A. Officer", LEGAL_COURT_CITY: "Bengaluru" });
  assert.equal(LEGAL.grievanceOfficer, "A. Officer");
  assert.equal(LEGAL.courtCity, "Bengaluru");
  assert.equal(legalPartyLabel(), "Reelencer Technologies Private Limited, registered at 12 MG Road, Bengaluru 560001 (“Reelencer”, “we”, “us”)");
});
