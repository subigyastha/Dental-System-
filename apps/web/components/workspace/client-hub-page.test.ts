import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FollowUpCard } from "./client-hub-page";

const task = { id: "recall-a", dueAtIso: "2026-10-08T18:15:00Z", status: "Open", type: "Recall", summary: "Six-month dental recall", nextAction: "Call the client", canManage: true };

test("Client recall card offers date, next action, outcome and optional next routine recall controls", () => {
  const html = renderToStaticMarkup(createElement(FollowUpCard, { task, onSaved: () => undefined }));
  assert.match(html, /value="2026-10-09"/);
  assert.match(html, /Call outcome \/ next action/);
  assert.match(html, /Next routine recall after done/);
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
