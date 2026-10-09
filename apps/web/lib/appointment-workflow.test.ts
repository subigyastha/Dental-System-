import assert from "node:assert/strict";
import test from "node:test";
import { getPrimaryAppointmentAction } from "./appointment-workflow";

test("the daily flow has confirmation, check-in and completion without a required start step", () => {
  assert.equal(getPrimaryAppointmentAction("Scheduled")?.status, "Confirmed");
  assert.equal(getPrimaryAppointmentAction("Confirmed")?.status, "CheckedIn");
  assert.equal(getPrimaryAppointmentAction("CheckedIn")?.status, "Completed");
  assert.equal(getPrimaryAppointmentAction("InProgress")?.status, "Completed");
  for (const status of ["Completed", "Cancelled", "NoShow", "Rescheduled", "FollowUpRequired"] as const) {
    assert.equal(getPrimaryAppointmentAction(status), null);
  }
});
