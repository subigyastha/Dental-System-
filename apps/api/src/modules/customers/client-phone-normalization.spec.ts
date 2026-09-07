import assert from "node:assert/strict";
import test from "node:test";

import { normalizeClientPhone } from "./client-phone-normalization";

test("Nepal phone normalization treats local and international mobile forms as one identity", () => {
  const expected = "9779800000000";
  assert.equal(normalizeClientPhone("+977 980-000-0000"), expected);
  assert.equal(normalizeClientPhone("00977 9800000000"), expected);
  assert.equal(normalizeClientPhone("9800000000"), expected);
  assert.equal(normalizeClientPhone("09800000000"), expected);
});

test("phone normalization retains a safe digits-only fallback for non-Nepal formats", () => {
  assert.equal(normalizeClientPhone("+1 (415) 555-0100"), "14155550100");
  assert.equal(normalizeClientPhone("not recorded"), "");
});
