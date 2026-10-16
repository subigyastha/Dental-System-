import assert from "node:assert/strict";
import test from "node:test";
import { contactAge, staffFollowupDate } from "./staff-followup";
const now = new Date("2026-10-10T10:00:00+05:45");
test("staff can schedule today without a time, or explicitly choose later today", () => {
  assert.deepEqual(staffFollowupDate("2026-10-10", "", now), { dueAtIso: "2026-10-09T18:15:00.000Z", dateOnly: true });
  assert.equal(staffFollowupDate("2026-10-10", "11:00", now).dateOnly, false);
  for (const [date, time] of [["2026-10-10", "09:00"], ["2026-10-09", ""], ["2026-02-30", ""], ["2026-10-11", "24:00"]]) assert.throws(() => staffFollowupDate(date, time, now));
});
test("contact recency counts Nepal calendar days and distinguishes no recorded contact", () => {
  assert.equal(contactAge(null, now), "Not recorded");
  assert.equal(contactAge("2026-10-09T18:20:00Z", now), "Today");
  assert.equal(contactAge("2026-10-09T17:00:00Z", now), "Yesterday");
  assert.equal(contactAge("2026-10-01T00:00:00+05:45", now), "9 days ago");
  assert.equal(contactAge("2026-10-17T00:00:00+05:45", now), "Future date");
});
