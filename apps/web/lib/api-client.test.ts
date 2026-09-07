import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiRequestError,
  apiFetchJson,
  rememberCsrfToken,
} from "./api-client";
import { subscribeToSessionEnd } from "./session-events";

test("cookie transport never sends a bearer header", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({ ok: true });
  }) as typeof fetch;

  try {
    await apiFetchJson("/auth/me");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init?.credentials, "include");
    assert.equal(new Headers(requests[0].init?.headers).has("authorization"), false);
    assert.ok(requests[0].init?.signal instanceof AbortSignal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unsafe cookie requests obtain and send an in-memory CSRF token", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  rememberCsrfToken();
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), init });
    return requests.length === 1
      ? Response.json({ csrfToken: "test-csrf-token" })
      : Response.json({ ok: true });
  }) as typeof fetch;

  try {
    await apiFetchJson("/appointments", { method: "POST" });
    assert.match(requests[0].url, /\/auth\/csrf$/);
    assert.equal(new Headers(requests[1].init?.headers).get("x-csrf-token"), "test-csrf-token");
    assert.equal(new Headers(requests[1].init?.headers).has("authorization"), false);
  } finally {
    rememberCsrfToken();
    globalThis.fetch = originalFetch;
  }
});

test("an expired cookie session emits the global sign-in event", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const browserEvents = new EventTarget();
  let expiredEvents = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserEvents,
  });
  const unsubscribe = subscribeToSessionEnd(() => {
    expiredEvents += 1;
  });
  globalThis.fetch = (async () =>
    Response.json(
      { error: { message: "Invalid session" } },
      { status: 401 },
    )) as typeof fetch;

  try {
    await assert.rejects(apiFetchJson("/auth/me"), /Invalid session/);
    assert.equal(expiredEvents, 1);
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("v1 errors preserve a safe domain reason for deterministic recovery", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json(
      {
        error: {
          code: "conflict",
          reason: "HOLD_EXPIRED",
          message: "The selected hold expired.",
        },
        meta: { requestId: "request-a" },
      },
      { status: 409 },
    )) as typeof fetch;

  try {
    await assert.rejects(
      apiFetchJson("/v1/booking/confirm"),
      (error: unknown) =>
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.reason === "HOLD_EXPIRED" &&
        error.requestId === "request-a",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
