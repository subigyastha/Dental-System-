import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError } from "./api-client";
import { loadScheduleDay, scheduleLoadErrorMessage } from "./schedule-day";

const query = new URLSearchParams({ date: "2026-10-16", providerIds: "provider-a", locationId: "location-a" });

test("schedule reads recover one mobile connection failure using the same scoped GET", async () => {
  const original = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), init });
    if (requests.length === 1) throw new TypeError("Load failed");
    return Response.json({ data: { grid: { date: "2026-10-16" } }, meta: { apiVersion: "v1" } });
  }) as typeof fetch;
  try {
    assert.deepEqual(await loadScheduleDay(query), { grid: { date: "2026-10-16" } });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, requests[1].url);
    for (const request of requests) {
      assert.equal(request.init?.method ?? "GET", "GET");
      assert.equal(request.init?.credentials, "include");
      assert.equal(request.init?.cache, "no-store");
    }
  } finally { globalThis.fetch = original; }
});

test("slow schedule reads share a 60-second total budget, including a transient retry", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalTimeout = AbortSignal.timeout;
  let now = 1000;
  let calls = 0;
  const deadlines: number[] = [];
  Date.now = () => now;
  AbortSignal.timeout = ((ms: number) => { deadlines.push(ms); return new AbortController().signal; }) as typeof AbortSignal.timeout;
  globalThis.fetch = (async () => {
    if (++calls === 1) { now += 9000; return Response.json({ message: "Waking up" }, { status: 503 }); }
    return Response.json({ data: { ok: true }, meta: { apiVersion: "v1" } });
  }) as typeof fetch;
  try {
    assert.deepEqual(await loadScheduleDay(query), { ok: true });
    assert.deepEqual(deadlines, [60_000, 51_000]);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; AbortSignal.timeout = originalTimeout; }
});

test("schedule reads never retry denied sessions, permissions or invalid dates", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [400, 401, 403, 404, 429]) {
      let calls = 0;
      globalThis.fetch = (async () => { calls++; return Response.json({ message: "Rejected" }, { status }); }) as typeof fetch;
      await assert.rejects(loadScheduleDay(query), (error: unknown) => error instanceof ApiRequestError && error.status === status);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});

test("an exhausted wake budget stops retries and transient outages stop after two attempts", async () => {
  const original = globalThis.fetch;
  const originalNow = Date.now;
  let now = 0;
  let calls = 0;
  Date.now = () => now;
  try {
    globalThis.fetch = (async () => { calls++; now += 60_000; throw new TypeError("Offline"); }) as typeof fetch;
    await assert.rejects(loadScheduleDay(query), TypeError);
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({}, { status: 503 }); }) as typeof fetch;
    await assert.rejects(loadScheduleDay(query), (error: unknown) => error instanceof ApiRequestError && error.status === 503);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; Date.now = originalNow; }
});

test("schedule errors distinguish network, timeout, permission and invalid date failures", () => {
  assert.match(scheduleLoadErrorMessage(new TypeError("Load failed")), /Check your connection/);
  assert.match(scheduleLoadErrorMessage(new ApiRequestError("The server took too long to respond. Please try again.", 408)), /too long/);
  assert.match(scheduleLoadErrorMessage(new ApiRequestError("Denied", 403)), /permission/);
  assert.match(scheduleLoadErrorMessage(new ApiRequestError("Date is invalid", 400)), /Date is invalid/);
});
