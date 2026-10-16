import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FollowupWorkTable, FollowupStatusBoard, type FollowupWorkTask } from "./followup-work-queue";
import { DataTableControls } from "./data-table";
import { FollowupClientTable, FollowupSummary, type FollowupClient, type FollowupClientWithPlan } from "./followup-client-suggestions";

const task: FollowupWorkTask = { id: "case", customerId: "client", appointmentId: "visit", type: "TreatmentContinuation", status: "Waiting", summary: "Extraction follow-up", nextAction: "Contact client", dueAtIso: "2026-10-10T08:15:00Z", updatedAtIso: "2026-10-10T04:45:00Z", canManage: true,
  client: { name: "Test client", phone: "9800000000", code: "CL-1" }, visit: { startsAtIso: "2026-10-09T04:45:00Z", label: "Extraction", locationId: "location", provider: "Dr Test" },
  lastResponse: { label: "Asked to contact later", note: "<script>Callback after lunch</script>", atIso: "2026-10-10T04:45:00Z", nextContactAtIso: "2026-10-10T08:15:00Z" } };

test("work table has official headers, client contact, visit, last response and escaped optional note", () => {
  const html = renderToStaticMarkup(createElement(FollowupWorkTable, { items: [task], onOpen: () => undefined }));
  assert.match(html, /<thead/); assert.match(html, /<th[^>]*scope="col"[^>]*>Last response<\/th>/);
  assert.match(html, /9800000000/); assert.match(html, /Dr Test/);
  assert.match(html, /Asked to contact later/); assert.match(html, /&lt;script&gt;Callback after lunch/);
  assert.doesNotMatch(html, /<script>/); assert.match(html, /Log follow-up/);
});

test("client suggestions have table headers and show recency, return context and two staff actions", () => {
  const client: FollowupClient = { customerId: "client", name: "<script>Client</script>", phone: "9800000000", code: "CL-1", canManage: true,
    visit: { id: "visit", atIso: new Date().toISOString(), label: "Treatment", provider: "Doctor" },
    lastAttemptAtIso: new Date().toISOString(), lastReachedAtIso: null, nextContactAtIso: null, upcomingVisitAtIso: new Date().toISOString() };
  const html = renderToStaticMarkup(createElement(FollowupClientTable, { items: [client] }));
  assert.match(html, /<thead/); assert.match(html, /these are not scheduled reminders/);
  assert.match(html, /Last attempt: Today/); assert.match(html, /Last spoke to client: Not recorded/); assert.match(html, /No follow-up scheduled/);
  assert.match(html, /Returning:/); assert.match(html, /Log follow-up/); assert.match(html, /Schedule follow-up/);
  assert.doesNotMatch(html, /<script>/);
  const readonly = renderToStaticMarkup(createElement(FollowupClientTable, { items: [{ ...client, canManage: false }] }));
  assert.doesNotMatch(readonly, /<button/); assert.match(readonly, /read-only for follow-ups/);
});

test("finished and unauthorized tasks show history as their only action", () => {
  for (const changes of [{ status: "Done" }, { canManage: false }]) {
    const html = renderToStaticMarkup(createElement(FollowupWorkTable, { items: [{ ...task, ...changes }], onOpen: () => undefined }));
    assert.match(html, /View history/); assert.doesNotMatch(html, /Log follow-up/);
  }
});

test("compact appointment/client follow-up summary shows a plan or a clear scheduling action without a work table", () => {
  const client: FollowupClientWithPlan = { customerId: "client", name: "Client", phone: "", code: null, canManage: true, visit: null,
    lastAttemptAtIso: null, lastReachedAtIso: null, nextContactAtIso: null, upcomingVisitAtIso: null };
  const empty = renderToStaticMarkup(createElement(FollowupSummary, { client }));
  assert.match(empty, /No upcoming follow-up/); assert.match(empty, /Log follow-up/); assert.match(empty, /Schedule follow-up/);
  assert.doesNotMatch(empty, /<table|Last attempt|No completed visit/);
  const planned = renderToStaticMarkup(createElement(FollowupSummary, { client: { ...client, upcomingFollowup: {
    id: "reminder", appointmentId: null, dueAtIso: "2030-01-01T18:15:00Z", dateOnly: true, updatedAtIso: "2026-01-01T00:00:00Z", reason: "Doctor requested check-in", canManage: true,
  } } }));
  assert.match(planned, /Next follow-up/); assert.match(planned, /Doctor requested check-in/); assert.doesNotMatch(planned, /No upcoming follow-up/);
});

test("an actionable appointment-needed task offers direct booking without recording another attempt", () => {
  const appointmentTask = { ...task, status: "Open", lastResponse: { ...task.lastResponse!, response: "appointment_needed", label: "Appointment needed" } };
  const html = renderToStaticMarkup(createElement(FollowupWorkTable, { items: [appointmentTask], onOpen: () => undefined, onBook: () => undefined }));
  assert.match(html, /Book appointment/); assert.match(html, /Log follow-up/);
  const closed = renderToStaticMarkup(createElement(FollowupWorkTable, { items: [{ ...appointmentTask, status: "Done" }], onOpen: () => undefined, onBook: () => undefined }));
  assert.doesNotMatch(closed, /Book appointment/);
});

test("shared table headers expose server sort direction and the same toolbar supports filtering", () => {
  const html = renderToStaticMarkup(createElement(FollowupWorkTable, { items: [task], onOpen: () => undefined,
    sort: { key: "client", direction: "desc" }, onSort: () => undefined }));
  assert.match(html, /aria-sort="descending"/); assert.match(html, /Client \/ contact ↓/); assert.match(html, /aria-sort="none"/);
  const toolbar = renderToStaticMarkup(createElement(DataTableControls, { search: "Test", onSearch: () => undefined,
    sort: { key: "client", direction: "desc" }, sortOptions: [{ value: "client", label: "Client" }], onSort: () => undefined, onReset: () => undefined }));
  assert.match(toolbar, /Sort by/); assert.match(toolbar, /Order/); assert.match(toolbar, /Reset filters/); assert.match(toolbar, /value="Test"/);
});

test("status board preserves outcome, notes and permissions and distinguishes unloaded from empty columns", () => {
  const html = renderToStaticMarkup(createElement(FollowupStatusBoard, { items: [task, { ...task, id: "done", status: "Done", client: { ...task.client, name: "<script>Closed client</script>" } }],
    counts: { Open: 8, InProgress: 0, Waiting: 1, Blocked: 0, Done: 1 }, onOpen: () => undefined, onSchedule: () => undefined }));
  assert.match(html, /To contact · 8/); assert.match(html, /More records available/); assert.match(html, /0 loaded of 8/);
  assert.match(html, /Asked to contact later/); assert.match(html, /&lt;script&gt;Callback after lunch/);
  assert.doesNotMatch(html, /<script>/); assert.match(html, /Provider review/); assert.match(html, /View history/);
  const readonly = renderToStaticMarkup(createElement(FollowupStatusBoard, { items: [{ ...task, canManage: false }], counts: { Waiting: 1 }, onOpen: () => undefined, onSchedule: () => undefined }));
  assert.doesNotMatch(readonly, /Log follow-up|Reschedule/); assert.match(readonly, /View history/);
});
