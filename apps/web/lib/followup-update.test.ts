import assert from "node:assert/strict";
import test from "node:test";

import { buildFollowupUpdate } from "./followup-update";

test("follow-up next attempt uses midnight in the clinic timezone and the recorded next action", () => {
  assert.deepEqual(buildFollowupUpdate("Open", "  Call next week  ", "2026-10-16"), {
    status: "Open", outcome: "Call next week", dueAtIso: "2026-10-16T00:00:00+05:45",
  });
});

test("Done uses the default next recall unless staff choose a separate next routine date", () => {
  assert.deepEqual(buildFollowupUpdate("Done", "Contacted", ""), { status: "Done", outcome: "Contacted" });
  assert.equal(buildFollowupUpdate("Done", "Contacted", "2027-04-09").dueAtIso, "2027-04-09T00:00:00+05:45");
});

test("empty outcomes and invalid calendar dates are rejected before a request", () => {
  assert.throws(() => buildFollowupUpdate("Done", " ", ""), /outcome/);
  assert.throws(() => buildFollowupUpdate("Open", "Call", ""), /valid/);
  assert.throws(() => buildFollowupUpdate("Open", "Call", "2026-02-30"), /valid/);
});
