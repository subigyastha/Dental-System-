import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ClientDirectoryTable, FollowUpCard } from "./client-hub-page";

const task = { id: "recall-a", dueAtIso: "2026-10-08T18:15:00Z", status: "Open", type: "Recall", summary: "Six-month dental recall", nextAction: "Call the client", canManage: true };
const client = { id: "client-a", clientCode: "CL-1", name: "Test client", phone: "9800000000", email: null, risk: "Routine", lastVisitIso: task.dueAtIso };

test("Legacy client recall card supports manual updates without a next automatic recall", () => {
  const html = renderToStaticMarkup(createElement(FollowUpCard, { task, onSaved: () => undefined }));
  assert.match(html, /value="2026-10-09"/);
  assert.match(html, /Outcome \/ next action/);
  assert.doesNotMatch(html, /Next routine recall after done/);
  assert.match(html, /Save next date/);
  assert.match(html, /Mark done/);
});

test("completed and unauthorized Client tasks preserve visible history without write controls", () => {
  for (const changes of [{ status: "Done" }, { canManage: false }]) {
    const html = renderToStaticMarkup(createElement(FollowUpCard, { task: { ...task, ...changes }, onSaved: () => undefined }));
    assert.match(html, /Call the client/);
    assert.doesNotMatch(html, /Mark done|Save next date/);
  }
});

test("case-specific tasks do not suggest a recurring routine recall", () => {
  const html = renderToStaticMarkup(createElement(FollowUpCard, { task: { ...task, type: "TreatmentContinuation" }, onSaved: () => undefined }));
  assert.doesNotMatch(html, /Next routine recall after done/);
});

test("due list shows procedure reasons, dates, next actions and remaining task count", () => {
  const html = renderToStaticMarkup(createElement(ClientDirectoryTable, { dueOnly: true, items: [{ ...client,
    dueFollowUps: [{ ...task, type: "TreatmentContinuation", summary: "Extraction review", nextAction: "Arrange review" }],
    dueFollowUpCount: 4, needsRecallReview: false,
  }] }));
  assert.match(html, /Procedure follow-up/);
  assert.match(html, /Extraction review/);
  assert.match(html, /Arrange review/);
  assert.match(html, /3 more due tasks/);
  assert.match(html, /<thead/);
  assert.match(html, /<th[^>]*scope="col"[^>]*>Due date<\/th>/);
  assert.doesNotMatch(html, /Historical recall review needed/);
});

test("historical recall review is distinguished from a scheduled due task", () => {
  const html = renderToStaticMarkup(createElement(ClientDirectoryTable, { dueOnly: true, items: [{ ...client, dueFollowUps: [], dueFollowUpCount: 0, needsRecallReview: true }] }));
  assert.match(html, /Historical recall review/);
  assert.match(html, /Not scheduled/);
});

test("client directory uses shared sortable headers and distinguishes an absent recorded visit", () => {
  const html = renderToStaticMarkup(createElement(ClientDirectoryTable, { dueOnly: false, items: [{ ...client, lastRecordedVisitIso: null }],
    sort: { key: "name", direction: "desc" }, onSort: () => undefined }));
  assert.match(html, /aria-sort="descending"/); assert.match(html, /Client ↓/); assert.match(html, /Last visit/);
  assert.match(html, /Last visit: Not recorded/); assert.match(html, /Risk: Routine/); assert.match(html, /9800000000/);
});

test("responsive client rows keep each due reason, contact and action while escaping details", () => {
  const html = renderToStaticMarkup(createElement(ClientDirectoryTable, { dueOnly: true, items: [{ ...client, name: "<script>Client</script>", email: "household@example.test",
    dueFollowUps: [{ ...task, summary: "<script>First reason</script>" }, { ...task, id: "second", summary: "Second reason", nextAction: "Call after lunch" }], dueFollowUpCount: 5,
  }] }));
  assert.match(html, /rowSpan="2"/i); assert.match(html, /household@example.test/); assert.match(html, /3 more due tasks/);
  assert.match(html, /&lt;script&gt;First reason/); assert.match(html, /Call after lunch/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /hidden sm:table-cell/); assert.match(html, /Review follow-ups/);
});
