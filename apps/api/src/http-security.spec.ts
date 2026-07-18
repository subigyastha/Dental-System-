import assert from "node:assert/strict";
import test from "node:test";

import { allowedOrigins, createRateLimit, securityHeaders } from "./http-security";

function responseRecorder() {
  const headers = new Map<string, string>();
  let statusCode: number | undefined;
  let body: unknown;
  return {
    response: {
      setHeader(name: string, value: string) { headers.set(name, value); },
      status(code: number) {
        statusCode = code;
        return { json(value: unknown) { body = value; } };
      },
    },
    headers,
    result: () => ({ statusCode, body }),
  };
}

test("CORS defaults are local only and production requires explicit origins", () => {
  assert.deepEqual(allowedOrigins({ NODE_ENV: "development" }), ["http://localhost:3000", "http://127.0.0.1:3000"]);
  assert.deepEqual(allowedOrigins({ NODE_ENV: "production" }), []);
  assert.deepEqual(allowedOrigins({ NODE_ENV: "production", CORS_ORIGINS: "https://clinic.example, https://admin.example" }), ["https://clinic.example", "https://admin.example"]);
});

test("security middleware preserves a supplied correlation id and hardens response headers", () => {
  const capture = responseRecorder();
  const request: { path: string; requestId?: string; header(name: string): string | undefined } = {
    path: "/api/customers",
    header: (name: string) => name === "x-request-id" ? "trace-123" : undefined,
  };
  let nextCalls = 0;

  securityHeaders(request, capture.response, () => { nextCalls += 1; });
  assert.equal(request.requestId, "trace-123");
  assert.equal(capture.headers.get("x-frame-options"), "DENY");
  assert.equal(capture.headers.get("x-content-type-options"), "nosniff");
  assert.equal(nextCalls, 1);
});

test("login rate limiting returns 429 after the configured threshold", () => {
  const limit = createRateLimit({ loginLimit: 1 });
  const first = responseRecorder();
  const second = responseRecorder();
  const request = { path: "/api/auth/login", ip: "127.0.0.1", header: () => undefined };
  let nextCalls = 0;

  limit(request, first.response, () => { nextCalls += 1; });
  limit(request, second.response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(second.result().statusCode, 429);
  assert.deepEqual(second.result().body, { statusCode: 429, message: "Too many requests" });
});
