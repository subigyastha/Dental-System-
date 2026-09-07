import assert from "node:assert/strict";
import test from "node:test";

import { rememberCsrfToken } from "./api-client";
import { loadClinicSettings, updateClinicSettings } from "./settings-api";

const response = {
  data: {
    capabilities: { canEdit: true, canManageSlotInterval: true },
    organization: { id: "clinic-a", name: "Clinic A", email: null, phone: null, address: null, timezone: "Asia/Kathmandu", primaryCalendar: "AD" },
    scheduling: { businessDayStartsAt: "08:00", businessDayEndsAt: "18:00", defaultBufferMinutes: 10, bookingHoldMinutes: 3, slotStartIntervalMinutes: 15, scheduleConfigurationVersion: 1, reminderLeadMinutes: 1440, allowOverlaps: false },
  },
  meta: { apiVersion: "v1" },
};

test("Settings reads only its bounded v1 route", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  globalThis.fetch = (async (input) => {
    url = String(input);
    return Response.json(response);
  }) as typeof fetch;
  try {
    await loadClinicSettings();
    assert.equal(url, "/api/v1/settings");
    assert.equal(url.includes("operational-data"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Settings update is protected and never sends an overlap toggle", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  rememberCsrfToken("test-csrf");
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), init };
    return Response.json(response);
  }) as typeof fetch;
  try {
    await updateClinicSettings({
      name: "Clinic A",
      businessDayStartsAt: "08:00",
      businessDayEndsAt: "18:00",
      defaultBufferMinutes: 10,
      bookingHoldMinutes: 3,
      slotStartIntervalMinutes: 15,
      reminderLeadMinutes: 1440,
    });
    assert.equal(request?.url, "/api/v1/settings");
    assert.equal(request?.init?.method, "PATCH");
    assert.ok(new Headers(request?.init?.headers).has("x-csrf-token"));
    assert.equal(JSON.parse(String(request?.init?.body)).allowOverlaps, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    rememberCsrfToken();
  }
});
