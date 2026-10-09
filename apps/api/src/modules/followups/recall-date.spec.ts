import assert from "node:assert/strict";
import test from "node:test";

import { defaultRecallDate } from "./recall-date";

for (const [visit, expected] of [
  ["2026-08-31T09:00:00+05:45", "2027-02-27T18:15:00.000Z"],
  ["2027-08-31T09:00:00+05:45", "2028-02-28T18:15:00.000Z"],
  ["2026-12-31T09:00:00+05:45", "2027-06-29T18:15:00.000Z"],
  ["2026-01-31T20:00:00Z", "2026-07-31T18:15:00.000Z"],
]) {
  test(`six-calendar-month recall clamps the Nepal clinic date for ${visit}`, () => {
    assert.equal(defaultRecallDate(new Date(visit)).toISOString(), expected);
  });
}
