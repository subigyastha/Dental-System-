import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDayTimeline,
  groupScheduleSlots,
  replacementCancellationNote,
  type ScheduleSlot,
} from "./schedule-display";
import type { Appointment } from "./domain";

function at(minutes: number): string {
  return new Date(Date.UTC(2030, 0, 1, 9, minutes)).toISOString();
}

function booked(
  minutes: number,
  appointmentId = "appointment-a",
  endMinutes = 60,
): ScheduleSlot {
  return {
    startTime: at(minutes),
    endTime: at(endMinutes),
    state: "BOOKED",
    appointmentId,
    appointmentSummary: {
      customerName: "Client A",
      serviceName: "Visit",
      status: "Scheduled",
    },
  };
}

for (const duration of [30, 45, 60]) {
  test(`${duration}-minute appointment becomes one block with its original API end`, () => {
    const slots = Array.from({ length: duration / 15 }, (_, index) =>
      booked(index * 15, "appointment-a", duration),
    );
    const groups = groupScheduleSlots(slots);
    assert.deepEqual(groups, [
      { slot: slots[0], startRow: 0, rowSpan: duration / 15 },
    ]);
    assert.equal(groups[0].slot, slots[0]);
    assert.equal(groups[0].slot.endTime, at(duration));
    assert.equal(slots.length, duration / 15);
  });
}

test("different appointments for the same client stay separate", () => {
  const groups = groupScheduleSlots([booked(0), booked(15, "appointment-b")]);
  assert.deepEqual(
    groups.map((group) => group.rowSpan),
    [1, 1],
  );
});

test("provider grouping is independent even when appointment IDs match", () => {
  assert.equal(groupScheduleSlots([booked(0)]).length, 1);
  assert.equal(groupScheduleSlots([booked(15)]).length, 1);
});

test("missing provider cells and gaps in the whole grid split booked blocks", () => {
  const slots = [booked(0), booked(30)];
  assert.deepEqual(
    groupScheduleSlots(slots, [at(0), at(15), at(30)]).map((group) => [
      group.startRow,
      group.rowSpan,
    ]),
    [
      [0, 1],
      [2, 1],
    ],
  );
  assert.deepEqual(
    groupScheduleSlots(slots).map((group) => group.rowSpan),
    [1, 1],
  );
});

test("global row indices and unsorted provider input preserve the first original cell", () => {
  const first = booked(15);
  const last = booked(30);
  const slots = [last, first];
  assert.deepEqual(groupScheduleSlots(slots, [at(0), at(15), at(30)]), [
    { slot: first, startRow: 1, rowSpan: 2 },
  ]);
  assert.deepEqual(slots, [last, first]);
});

test("booked cells without detail remain booked and preserve partial buffer occupancy", () => {
  const first = {
    ...booked(0, "appointment-a", 37),
    appointmentSummary: undefined,
  };
  const second = {
    ...booked(15, "appointment-a", 37),
    appointmentSummary: undefined,
  };
  const groups = groupScheduleSlots([
    first,
    second,
    booked(30, "appointment-a", 37),
  ]);
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
    assert.deepEqual(
      groups.map((group) => group.rowSpan),
      [1, 1],
    );
    assert.ok(groups.every((group) => group.slot.state === "BOOKED"));
  }
});

test("available and cancelled cells stay individually bookable and break booked runs", () => {
  const available: ScheduleSlot = {
    startTime: at(15),
    endTime: at(30),
    state: "AVAILABLE",
  };
  const cancelled: ScheduleSlot = {
    startTime: at(30),
    endTime: at(45),
    state: "AVAILABLE",
    cancelledSummary: { customerName: "Client A", reason: "Changed plans" },
  };
  const groups = groupScheduleSlots([
    booked(0),
    available,
    cancelled,
    booked(45),
  ]);
  assert.deepEqual(
    groups.map((group) => group.rowSpan),
    [1, 1, 1, 1],
  );
  assert.equal(groups[1].slot, available);
  assert.equal(groups[2].slot, cancelled);
});

test("blocked and unavailable cells split booked runs even with a matching ID", () => {
  for (const state of ["BLOCKED", "UNAVAILABLE"] as const) {
    const groups = groupScheduleSlots([
      booked(0),
      { ...booked(15), state },
      booked(30),
    ]);
    assert.deepEqual(
      groups.map((group) => group.rowSpan),
      [1, 1, 1],
    );
  }
});

test("an explicit cadence supports a grid with shorter intervals", () => {
  assert.equal(
    groupScheduleSlots([booked(0), booked(5)], undefined, 5)[0].rowSpan,
    2,
  );
});

function visit(
  id: string,
  status: Appointment["status"],
  startsAtIso = at(0),
): Appointment {
  return {
    id,
    status,
    startsAtIso,
    organizationId: "clinic-a",
    providerId: "provider-a",
    customerId: "client-a",
    serviceIds: [],
    durationMinutes: 30,
    bufferMinutes: 0,
    priority: "Normal",
    chair: "",
    notes: "",
    communicationState: "Unconfirmed",
  };
}

test("terminal records remain on the timeline without changing available capacity", () => {
  const slots: ScheduleSlot[] = [0, 15, 30].map((minutes) => ({
    startTime: at(minutes),
    endTime: at(minutes + 15),
    state: "AVAILABLE",
  }));
  const original = structuredClone(slots);
  for (const status of ["Completed", "NoShow", "Cancelled"] as const) {
    const timeline = buildDayTimeline(
      slots,
      [visit("record-a", status)],
      "provider-a",
      "2030-01-01",
    );
    assert.equal(timeline.records.length, 1);
    assert.equal(timeline.records[0].group.slot.state, "HISTORY");
    assert.equal(timeline.records[0].group.rowSpan, 2);
    assert.deepEqual(slots, original);
  }
});

test("overlapping cancelled, completed and replacement visits keep separate record lanes", () => {
  const slots = [booked(0, "replacement", 30), booked(15, "replacement", 30)];
  const cancelled = {
    ...visit("cancelled", "Cancelled"),
    cancellationReason: "Changed plans",
  };
  const timeline = buildDayTimeline(
    slots,
    [
      cancelled,
      visit("completed", "Completed"),
      visit("replacement", "Confirmed"),
    ],
    "provider-a",
    "2030-01-01",
  );
  assert.equal(timeline.records.length, 3);
  assert.equal(timeline.laneCount, 3);
  assert.deepEqual(
    new Set(timeline.records.map((record) => record.group.slot.appointmentId)),
    new Set(["cancelled", "completed", "replacement"]),
  );
  assert.match(
    replacementCancellationNote(visit("replacement", "Confirmed"), [
      cancelled,
    ])!,
    /prior cancellation.*Changed plans/,
  );
  assert.equal(
    replacementCancellationNote(visit("replacement", "Confirmed", at(30)), [
      cancelled,
    ]),
    undefined,
    "an exact end boundary is not an overlap",
  );
});

test("history projection rejects other providers/dates, invalid timing and duplicate IDs", () => {
  const slots: ScheduleSlot[] = [0, 15].map((minutes) => ({
    startTime: at(minutes),
    endTime: at(minutes + 15),
    state: "AVAILABLE",
  }));
  const record = visit("record-a", "Completed");
  const timeline = buildDayTimeline(
    slots,
    [
      record,
      record,
      { ...record, id: "other-provider", providerId: "provider-b" },
      { ...record, id: "other-day", startsAtIso: "2030-01-02T09:00:00Z" },
      { ...record, id: "invalid", durationMinutes: -15 },
      { ...record, id: "invalid-date", startsAtIso: "invalid" },
    ],
    "provider-a",
    "2030-01-01",
  );
  assert.equal(timeline.records.length, 1);
});

test("off-grid history and partially updated snapshots cannot create capacity or duplicate a visit", () => {
  const slots = [booked(0), booked(15)];
  const timeline = buildDayTimeline(
    slots,
    [
      visit("appointment-a", "Completed"),
      visit("off-grid-history", "Completed", at(7)),
    ],
    "provider-a",
    "2030-01-01",
  );
  assert.equal(
    timeline.records.filter(
      (record) => record.group.slot.appointmentId === "appointment-a",
    ).length,
    1,
  );
  assert.deepEqual(
    slots.map((slot) => slot.startTime),
    [at(0), at(15)],
  );
});

test("extra off-grid rows within a booked interval remain one appointment block", () => {
  assert.equal(
    groupScheduleSlots([booked(0), booked(7), booked(15)])[0].rowSpan,
    3,
  );
});
