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
