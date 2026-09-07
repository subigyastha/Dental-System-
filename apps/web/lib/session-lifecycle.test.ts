import assert from "node:assert/strict";
import test from "node:test";

import { rememberCsrfToken } from "./api-client";
import { publishSessionEnd, subscribeToSessionEnd } from "./session-events";
import { logoutCurrentSession } from "./session-lifecycle";

test("logout waits for acknowledged server revocation and sends CSRF proof", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  rememberCsrfToken("csrf-proof");
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({ ok: true });
  }) as typeof fetch;

  try {
    assert.equal(await logoutCurrentSession(), "signed-out");
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/api\/auth\/logout$/);
    assert.equal(requests[0].init?.method, "POST");
    assert.equal(
      new Headers(requests[0].init?.headers).get("x-csrf-token"),
      "csrf-proof",
    );
    assert.equal(requests[0].init?.credentials, "include");
  } finally {
    rememberCsrfToken();
    globalThis.fetch = originalFetch;
  }
});

test("logout does not claim success when revocation cannot be confirmed", async () => {
  const originalFetch = globalThis.fetch;
  rememberCsrfToken("csrf-proof");
  globalThis.fetch = (async () => {
    throw new TypeError("network unavailable");
  }) as typeof fetch;

  try {
    await assert.rejects(logoutCurrentSession(), /network unavailable/);
  } finally {
    rememberCsrfToken();
    globalThis.fetch = originalFetch;
  }
});

test("an already expired session is a terminal logout result", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const browserEvents = new EventTarget();
  let reason: string | null = null;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserEvents,
  });
  const unsubscribe = subscribeToSessionEnd((nextReason) => {
    reason = nextReason;
  });
  rememberCsrfToken("csrf-proof");
  globalThis.fetch = (async () =>
    Response.json({ error: { message: "Invalid session" } }, { status: 401 })) as typeof fetch;

  try {
    assert.equal(await logoutCurrentSession(), "expired");
    assert.equal(reason, "expired");
  } finally {
    unsubscribe();
    rememberCsrfToken();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("session-end messages notify the current tab and validated peer tabs", () => {
  const originalWindow = globalThis.window;
  const channels: FakeBroadcastChannel[] = [];
  class FakeBroadcastChannel extends EventTarget {
    readonly posted: unknown[] = [];
    constructor(readonly name: string) {
      super();
      channels.push(this);
    }
    postMessage(value: unknown) {
      this.posted.push(value);
    }
    close() {}
  }
  const browserEvents = new EventTarget() as EventTarget & {
    BroadcastChannel: typeof BroadcastChannel;
  };
  Object.defineProperty(browserEvents, "BroadcastChannel", {
    configurable: true,
    value: FakeBroadcastChannel,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserEvents,
  });
  const reasons: string[] = [];
  const unsubscribe = subscribeToSessionEnd((reason) => reasons.push(reason));

  try {
    publishSessionEnd("signed-out");
    assert.deepEqual(reasons, ["signed-out"]);
    assert.equal(channels.length, 1);
    assert.deepEqual(channels[0].posted, [
      { type: "session-ended", version: 1, reason: "signed-out" },
    ]);

    channels[0].dispatchEvent(new MessageEvent("message", {
      data: { type: "session-ended", version: 1, reason: "expired" },
    }));
    channels[0].dispatchEvent(new MessageEvent("message", {
      data: { type: "session-ended", version: 99, reason: "signed-out" },
    }));
    assert.deepEqual(reasons, ["signed-out", "expired"]);
  } finally {
    unsubscribe();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

