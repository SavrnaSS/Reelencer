import test from "node:test";
import assert from "node:assert/strict";
import { matchesAccountOwnershipCode } from "../../lib/accountOwnershipCode";

test("ownership codes match normal bio placement, punctuation, case and copied formatting", () => {
  for (const bio of ["Creator\nRL-ABC234", "Code: rl-abc234 ✅", "(RL-ABC234)", "ＲＬ－ＡＢＣ２３４", "RL–ABC234", "RL\u200b-ABC\u200d234", "RL -\n ABC234", "[RL-ABC234] • creator"]) {
    assert.equal(matchesAccountOwnershipCode(bio, "RL-ABC234"), true, bio);
  }
});

test("a different, partial or longer token cannot prove ownership", () => {
  for (const bio of ["RL-ABC235", "RL-ABC23", "RL-ABC2349", "XRL-ABC234", "RL-ABC234_suffix", "RL-ABС234", "R L-ABC234", "RANDOM-RL-OTHER"]) {
    assert.equal(matchesAccountOwnershipCode(bio, "RL-ABC234"), false, bio);
  }
});

test("unreadable biographies and invalid expected codes never match", () => {
  for (const biography of [undefined, null, 12, {}, ""]) assert.equal(matchesAccountOwnershipCode(biography, "RL-ABC234"), false);
  for (const expectedCode of ["", "ABC234", "RL-ABC23", "RL-ABC2345", "RL-.*"]) assert.equal(matchesAccountOwnershipCode("RL-ABC234", expectedCode), false);
});
