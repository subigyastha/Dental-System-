import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildCalendarGrid } from "../../lib/calendar";

test("month cells expose sibling controls instead of nesting a button", async () => {
  const previousReact = (globalThis as { React?: typeof import("react") }).React;
  (globalThis as { React?: typeof import("react") }).React = await import("react");
  const { MonthPanel } = await import("./reservations-page");
  const html = renderToStaticMarkup(createElement(MonthPanel, {
    calendarMode: "AD",
    grid: buildCalendarGrid("2026-08-15", "AD"),
    onChangeMonth: () => undefined,
    onDaySelect: () => undefined,
    onOpenDay: () => undefined,
    selectedDate: "2026-08-15",
    summaries: new Map([["2026-08-15", {
      dateKey: "2026-08-15",
      appointmentCount: 1,
      providerMarkers: [{ providerId: "provider-a", color: "#0f766e", count: 1 }],
      hasAvailability: true,
    }]]),
    summaryLoading: false,
  }));

  assert.doesNotMatch(
    html,
    /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/,
    "a button must close before another button starts",
  );
  assert.match(html, /Open day schedule for 2026-08-15/);
  (globalThis as { React?: typeof import("react") }).React = previousReact;
});

test("a minimized workflow removes its modal surface so the workspace stays usable", async () => {
  const previousReact = (globalThis as { React?: typeof import("react") }).React;
  (globalThis as { React?: typeof import("react") }).React = await import("react");
  const { Drawer } = await import("./elements");
  const html = renderToStaticMarkup(createElement(
    Drawer,
    { hidden: true, onClose: () => undefined, title: "Background booking" },
    createElement("p", null, "Protected form"),
  ));

  assert.equal(html, "");
  (globalThis as { React?: typeof import("react") }).React = previousReact;
});

test("appointment editing takes exclusive ownership over the details drawer", async () => {
  const { resolveAppointmentOverlay } = await import("./reservations-page");

  assert.equal(resolveAppointmentOverlay(false, true), "details");
  assert.equal(resolveAppointmentOverlay(true, true), "editor");
  assert.equal(resolveAppointmentOverlay(true, false), "editor");
  assert.equal(resolveAppointmentOverlay(false, false), "none");
});

test("schedule request state starts loading before an empty state can render", async () => {
  const { isScheduleRequestPending } = await import("./reservations-page");

  assert.equal(isScheduleRequestPending(true, "day-a", null), true);
  assert.equal(isScheduleRequestPending(true, "day-a", "day-a"), false);
  assert.equal(isScheduleRequestPending(true, "day-b", "day-a"), true);
  assert.equal(isScheduleRequestPending(false, "day-b", "day-a"), false);
});


test("desktop and mobile occupied cells never become booking actions when details are missing", async () => {
  const previousReact = (globalThis as { React?: typeof import("react") }).React;
  (globalThis as { React?: typeof import("react") }).React = await import("react");
  try {
    const { ScheduleGridTable, MobileDayScheduleList } = await import("./reservations-page");
    const scheduleGrid = {
      date: "2030-01-01", timezone: "Asia/Kathmandu" as const,
      providers: [{ providerId: "provider-a", providerName: "Test Provider", providerColor: "#0f766e", specialty: "Dentist",
        slots: ["08:00", "08:15"].map((time) => ({ startTime: `2030-01-01T${time}:00+05:45`, endTime: "2030-01-01T08:30:00+05:45", state: "BOOKED" as const, appointmentId: "appointment-a", appointmentSummary: { customerName: "Test Client", serviceName: "Consultation", status: "Confirmed" as const } })),
      }],
    };
    for (const Component of [ScheduleGridTable, MobileDayScheduleList]) {
      const html = renderToStaticMarkup(createElement(Component, {
        appointmentById: new Map(), scheduleGrid,
        onBookedSlotClick: () => undefined, onOpenBooking: () => undefined,
      }));
      assert.equal((html.match(/Occupied until/g) ?? []).length, 2);
      assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
      assert.doesNotMatch(html, /Tap to book/);
      assert.match(html, /08:30/);
    }
  } finally {
    (globalThis as { React?: typeof import("react") }).React = previousReact;
  }
});


test("Schedule colors distinguish unconfirmed communication, confirmed visits and cancellations", async () => {
  const { scheduleAppointmentColor } = await import("./reservations-page");
  assert.equal(scheduleAppointmentColor("Scheduled", "Unconfirmed", "#123456"), "#ca8a04");
  assert.equal(scheduleAppointmentColor("Scheduled", "SMS sent", "#123456"), "#ca8a04");
  assert.equal(scheduleAppointmentColor("Scheduled", "Confirmed by phone", "#123456"), "#123456");
  assert.equal(scheduleAppointmentColor("Confirmed", "Unconfirmed", "#123456"), "#123456");
  assert.equal(scheduleAppointmentColor("Cancelled", "Confirmed by phone", "#123456"), "#dc2626");
});

test("week dates stay sticky inside the bounded Schedule scroll region", async () => {
  const { WeekPanel } = await import("./reservations-page");
  const html = renderToStaticMarkup(createElement(WeekPanel, {
    appointmentsByDate: new Map(), isLoading: false, onBookedSlotClick: () => undefined,
    onOpenBooking: () => undefined, onOpenDay: () => undefined, providerDetailsById: new Map(),
    visibleProviders: [], weekDateKeys: ["2030-01-01"], weekSummaryByDate: new Map(),
  }));
  assert.match(html, /max-h-\[70vh\] overflow-auto/);
  assert.match(html, /sticky top-0 z-10/);
  assert.match(html, /Tue/);
});
