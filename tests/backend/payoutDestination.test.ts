import test from "node:test";
import assert from "node:assert/strict";
import { destinationLabel, isValidAccountHolder, isValidAccountNumber, isValidIfsc, isValidUpi, maskAccountNumber, parseDestination } from "../../lib/payoutDestination";

test("destination keys distinguish UPI IDs from bank accounts and only the team sees full account numbers", () => {
  assert.deepEqual(parseDestination("asha@okhdfcbank"), { method: "UPI", upiId: "asha@okhdfcbank" });
  assert.deepEqual(parseDestination("bank:HDFC0001234:123456789012"), { method: "Bank", ifsc: "HDFC0001234", accountNumber: "123456789012" });
  assert.equal(parseDestination(""), null);
  assert.equal(maskAccountNumber("123456789012"), "••••9012");
  assert.equal(destinationLabel("bank:HDFC0001234:123456789012"), "A/c ••••9012 · HDFC0001234");
  assert.equal(destinationLabel("bank:HDFC0001234:123456789012", { full: true, holder: "Asha Rao" }), "A/c 123456789012 · HDFC0001234 · Asha Rao");
  assert.equal(destinationLabel("asha@okhdfcbank", { full: true }), "asha@okhdfcbank");
});

test("bank details validate like the database: IFSC shape, 9-18 digit accounts and plain-letter holder names", () => {
  for (const ifsc of ["HDFC0001234", "sbin0000001", " ICIC0ABC123 "]) assert.equal(isValidIfsc(ifsc), true, ifsc);
  for (const ifsc of ["HDFC1001234", "HDF0001234", "HDFC00012345", "HDFC-001234"]) assert.equal(isValidIfsc(ifsc), false, ifsc);
  for (const account of ["123456789", "1234 5678 9012", "123456789012345678"]) assert.equal(isValidAccountNumber(account), true, account);
  for (const account of ["12345678", "1234567890123456789", "12345678a"]) assert.equal(isValidAccountNumber(account), false, account);
  for (const name of ["Asha Rao", "D'Souza", "A. K. Singh"]) assert.equal(isValidAccountHolder(name), true, name);
  for (const name of ["A", "4sha", "Asha <b>", "-Asha"]) assert.equal(isValidAccountHolder(name), false, name);
  assert.equal(isValidUpi("asha@okhdfcbank"), true);
  assert.equal(isValidUpi("bank:HDFC0001234:123456789012"), false, "a bank key is never accepted as a UPI ID");
});
