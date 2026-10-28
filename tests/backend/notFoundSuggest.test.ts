import test from "node:test";
import assert from "node:assert/strict";
import { suggestPage } from "../../lib/notFoundSuggest";

test("404 suggestions catch typos and old paths", () => {
  assert.equal(suggestPage("/singup")?.href, "/signup");
  assert.equal(suggestPage("/Login/")?.href, "/login");
  assert.equal(suggestPage("/privacy-polcy")?.href, "/privacy");
  assert.equal(suggestPage("/terms.html")?.href, "/terms");
  assert.equal(suggestPage("/my-assignments/123")?.label, "My jobs");
  assert.equal(suggestPage("/wallet")?.href, "/payouts");
});

test("404 suggestions stay quiet without a confident match", () => {
  assert.equal(suggestPage("/"), null);
  assert.equal(suggestPage("/xyz"), null);
  assert.equal(suggestPage("/completely-unrelated-page"), null);
  assert.equal(suggestPage("/%E0%A4%A"), null);
});
