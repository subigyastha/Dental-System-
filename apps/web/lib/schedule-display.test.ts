import assert from "node:assert/strict";
import test from "node:test";

import { groupScheduleSlots, type ScheduleSlot } from "./schedule-display";

function at(minutes: number): string {
  return new Date(Date.UTC(2030, 0, 1, 9, minutes)).toISOString();
}

function booked(minutes: number, appointmentId = "appointment-a", endMinutes = 60): ScheduleSlot {
  return {
    startTime: at(minutes),
    endTime: at(endMinutes),
    state: "BOOKED",
    appointmentId,
    appointmentSummary: { customerName: "Client A", serviceName: "Visit", status: "Scheduled" },
  };
}

for (const duration of [30, 45, 60]) {
  test(`${duration}-minute appointment becomes one block with its original API end`, () => {
    const slots = Array.from({ length: duration / 15 }, (_, index) => booked(index * 15, "appointment-a", duration));
    const groups = groupScheduleSlots(slots);
    assert.deepEqual(groups, [{ slot: slots[0], startRow: 0, rowSpan: duration / 15 }]);
    assert.equal(groups[0].slot, slots[0]);
    assert.equal(groups[0].slot.endTime, at(duration));
    assert.equal(slots.length, duration / 15);
  });
}

test("different appointments for the same client stay separate", () => {
  const groups = groupScheduleSlots([booked(0), booked(15, "appointment-b")]);
  assert.deepEqual(groups.map((group) => group.rowSpan), [1, 1]);
});

test("provider grouping is independent even when appointment IDs match", () => {
  assert.equal(groupScheduleSlots([booked(0)]).length, 1);
  assert.equal(groupScheduleSlots([booked(15)]).length, 1);
});

test("missing provider cells and gaps in the whole grid split booked blocks", () => {
  const slots = [booked(0), booked(30)];
  assert.deepEqual(groupScheduleSlots(slots, [at(0), at(15), at(30)]).map((group) => [group.startRow, group.rowSpan]), [[0, 1], [2, 1]]);
  assert.deepEqual(groupScheduleSlots(slots).map((group) => group.rowSpan), [1, 1]);
});

test("global row indices and unsorted provider input preserve the first original cell", () => {
  const first = booked(15);
  const last = booked(30);
  const slots = [last, first];
  assert.deepEqual(groupScheduleSlots(slots, [at(0), at(15), at(30)]), [{ slot: first, startRow: 1, rowSpan: 2 }]);
  assert.deepEqual(slots, [last, first]);
});

test("booked cells without detail remain booked and preserve partial buffer occupancy", () => {
  const first = { ...booked(0, "appointment-a", 37), appointmentSummary: undefined };
  const second = { ...booked(15, "appointment-a", 37), appointmentSummary: undefined };
  const groups = groupScheduleSlots([first, second, booked(30, "appointment-a", 37)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rowSpan, 3);
  assert.equal(groups[0].slot.state, "BOOKED");
  assert.equal(groups[0].slot.appointmentSummary, undefined);
  assert.equal(groups[0].slot.endTime, at(37));
});

test("missing, empty, or whitespace appointment IDs never merge", () => {
  for (const appointmentId of [undefined, "", " "]) {
    const groups = groupScheduleSlots([
      { ...booked(0), appointmentId },
      { ...booked(15), appointmentId },
    ]);
    assert.deepEqual(groups.map((group) => group.rowSpan), [1, 1]);
    assert.ok(groups.every((group) => group.slot.state === "BOOKED"));
  }
});

test("available and cancelled cells stay individually bookable and break booked runs", () => {
  const available: ScheduleSlot = { startTime: at(15), endTime: at(30), state: "AVAILABLE" };
  const cancelled: ScheduleSlot = {
    startTime: at(30), endTime: at(45), state: "AVAILABLE",
    cancelledSummary: { customerName: "Client A", reason: "Changed plans" },
  };
  const groups = groupScheduleSlots([booked(0), available, cancelled, booked(45)]);
  assert.deepEqual(groups.map((group) => group.rowSpan), [1, 1, 1, 1]);
  assert.equal(groups[1].slot, available);
  assert.equal(groups[2].slot, cancelled);
});

test("blocked and unavailable cells split booked runs even with a matching ID", () => {
  for (const state of ["BLOCKED", "UNAVAILABLE"] as const) {
    const groups = groupScheduleSlots([booked(0), { ...booked(15), state }, booked(30)]);
    assert.deepEqual(groups.map((group) => group.rowSpan), [1, 1, 1]);
  }
});

test("an explicit cadence supports a grid with shorter intervals", () => {
  assert.equal(groupScheduleSlots([booked(0), booked(5)], undefined, 5)[0].rowSpan, 2);
});
