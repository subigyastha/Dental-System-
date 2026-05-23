import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNepalIsoFromDateAndTime,
  bsDateKeyToAdDateKey,
  formatTime,
  normalizeCalendarInputToAdDateKey,
  toDateKey,
} from "./index";
import { getProviderAvailableSlots, hasAppointmentOverlap } from "../../features/appointments/scheduling";
import type { Appointment, Provider, Service } from "../domain";

test("converts BS date to AD and back safely", () => {
  assert.equal(bsDateKeyToAdDateKey("2083-01-12"), "2026-04-25");
  assert.equal(normalizeCalendarInputToAdDateKey("२०८३-०१-१२", "BS"), "2026-04-25");
});

test("builds Nepal appointment ISO from BS-selected date", () => {
  const adDateKey = bsDateKeyToAdDateKey("2083-01-12");
  assert.equal(buildNepalIsoFromDateAndTime(adDateKey, "09:30"), "2026-04-25T03:45:00.000Z");
});

test("builds Nepal appointment ISO from AD-selected date", () => {
  assert.equal(buildNepalIsoFromDateAndTime("2026-04-25", "09:30"), "2026-04-25T03:45:00.000Z");
});

test("resolves Nepal local date boundaries from ISO correctly", () => {
  assert.equal(toDateKey("2026-05-05T18:30:00.000Z"), "2026-05-06");
  assert.equal(formatTime("2026-05-05T18:30:00.000Z"), "12:15 AM");
});

test("slot generation stays ISO-based after BS date selection", () => {
  const service: Service = {
    id: "svc-clean",
    name: "Cleaning",
    durationMinutes: 45,
    bufferMinutes: 15,
    category: "Preventive",
  };

  const provider: Provider = {
    id: "prov-1",
    name: "Dr. Mira",
    roleLabel: "Doctor",
    specialty: "General",
    color: "#006a61",
    capacityMinutes: 600,
    bookedMinutes: 0,
    status: "Available",
    availability: [
      {
        id: "avail-1",
        providerId: "prov-1",
        dayOfWeek: 6,
        startsAtLocal: "09:00",
        endsAtLocal: "12:00",
        slotDurationMinutes: 15,
        bufferMinutes: 15,
        isActive: true,
      },
    ],
    recurringBlocks: [],
    blockedTimes: [],
    serviceIds: ["svc-clean"],
  };

  const selectedAdDateKey = bsDateKeyToAdDateKey("2083-01-12");
  const appointments: Appointment[] = [
    {
      id: "appt-1",
      organizationId: "org-1",
      customerId: "cust-1",
      providerId: "prov-1",
      serviceIds: ["svc-clean"],
      startsAtIso: "2026-04-25T03:45:00.000Z",
      durationMinutes: 45,
      bufferMinutes: 15,
      status: "Scheduled",
      priority: "Normal",
      chair: "Chair 1",
      notes: "",
      communicationState: "Unconfirmed",
    },
  ];

  const slots = getProviderAvailableSlots({
    appointments,
    dateKey: selectedAdDateKey,
    providers: [provider],
    service,
  });

  assert.equal(slots.some((slot) => slot.time === "09:00"), false);
  assert.equal(slots.some((slot) => slot.time === "10:30"), true);
});

test("overlap validation still blocks conflicting time ranges", () => {
  const appointments: Appointment[] = [
    {
      id: "appt-1",
      organizationId: "org-1",
      customerId: "cust-1",
      providerId: "prov-1",
      serviceIds: ["svc-clean"],
      startsAtIso: "2026-04-25T03:45:00.000Z",
      durationMinutes: 45,
      bufferMinutes: 15,
      status: "Scheduled",
      priority: "Normal",
      chair: "Chair 1",
      notes: "",
      communicationState: "Unconfirmed",
    },
  ];

  assert.equal(
    hasAppointmentOverlap({
      appointments,
      blockedTimes: [],
      candidateStartMinutes: 9 * 60 + 15,
      candidateEndMinutes: 10 * 60,
      providerId: "prov-1",
      selectedDateKey: "2026-04-25",
    }),
    true,
  );
});

test("blocked times close otherwise open provider slots", () => {
  assert.equal(
    hasAppointmentOverlap({
      appointments: [],
      blockedTimes: [
        {
          id: "block-1",
          providerId: "prov-1",
          startsAtIso: "2026-04-25T06:15:00.000Z",
          endsAtIso: "2026-04-25T07:00:00.000Z",
          reason: "Lunch break",
        },
      ],
      candidateStartMinutes: 12 * 60,
      candidateEndMinutes: 12 * 60 + 30,
      providerId: "prov-1",
      selectedDateKey: "2026-04-25",
    }),
    true,
  );
});
