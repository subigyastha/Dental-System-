import assert from "node:assert/strict";
import test from "node:test";

import { apiFetchJson, rememberCsrfToken } from "./api-client";

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
