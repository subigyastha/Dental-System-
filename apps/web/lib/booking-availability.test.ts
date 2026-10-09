import assert from "node:assert/strict";
import test from "node:test";

import {
  formatHoldCountdown,
  createBookingSlotHold,
  loadRankedAvailability,
  isUncertainSlotHoldError,
  remainingHoldSeconds,
} from "./booking-availability";
import { ApiRequestError, rememberCsrfToken } from "./api-client";

const holdRequest = {
  draftId: "draft-a", locationId: "location-a", providerId: "provider-a", serviceId: "service-a",
  startsAtIso: "2030-01-01T04:15:00.000Z", slotId: "slot-a", availabilityVersion: "version-a", idempotencyKey: "same-key-after-timeout", durationMinutes: 45,
};

test("ranked availability sends custom duration and omits the override for service defaults", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url) => {
    urls.push(String(url));
    return Response.json({ data: { recommended: [], later: [] } });
  }) as typeof fetch;
  try {
    const params = { locationId: "clinic", providerId: "provider", serviceId: "service", date: "2030-01-01" };
    await loadRankedAvailability({ ...params, durationMinutes: 75 });
    await loadRankedAvailability(params);
    assert.equal(new URL(urls[0], "https://clinic.test").searchParams.get("durationMinutes"), "75");
    assert.equal(new URL(urls[1], "https://clinic.test").searchParams.has("durationMinutes"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a lost hold response retries the same payload and idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  rememberCsrfToken("test-csrf");
  globalThis.fetch = (async (_url, init) => {
    requests.push(init!);
    if (requests.length === 1) throw new TypeError("Network response lost after commit");
    return Response.json({ data: { id: "original-hold", status: "active" } });
  }) as typeof fetch;
  try {
    const recovered = await createBookingSlotHold(holdRequest);
    assert.equal(recovered.id, "original-hold");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].body, requests[1].body);
    assert.deepEqual(JSON.parse(String(requests[1].body)), holdRequest);
    assert.equal(new Headers(requests[0].headers).get("Idempotency-Key"), holdRequest.idempotencyKey);
    assert.equal(new Headers(requests[1].headers).get("Idempotency-Key"), holdRequest.idempotencyKey);
  } finally {
    globalThis.fetch = originalFetch;
    rememberCsrfToken();
  }
});

test("hold recovery is bounded and distinguishes uncertainty from rejected writes", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  rememberCsrfToken("test-csrf");
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ message: "Unavailable" }, { status: 503 });
  }) as typeof fetch;
  try {
    await assert.rejects(createBookingSlotHold(holdRequest), (error: unknown) => isUncertainSlotHoldError(error));
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({ message: "Taken" }, { status: 409 });
    }) as typeof fetch;
    await assert.rejects(createBookingSlotHold(holdRequest), (error: unknown) => error instanceof ApiRequestError && error.status === 409);
    assert.equal(calls, 1);
    assert.equal(isUncertainSlotHoldError(new ApiRequestError("Timeout", 408)), true);
    assert.equal(isUncertainSlotHoldError(new ApiRequestError("Unauthorized", 401)), false);
  } finally {
    globalThis.fetch = originalFetch;
    rememberCsrfToken();
  }
});

test("hold countdown derives from the server expiry instead of decrement state", () => {
  assert.equal(
    remainingHoldSeconds("2030-01-01T00:03:00.000Z", Date.parse("2030-01-01T00:00:00.000Z")),
    180,
  );
  assert.equal(
    remainingHoldSeconds("2030-01-01T00:00:00.000Z", Date.parse("2030-01-01T00:03:00.000Z")),
    0,
  );
});

test("hold countdown uses a stable tabular minute-second label", () => {
  assert.equal(formatHoldCountdown(180), "3:00");
  assert.equal(formatHoldCountdown(61), "1:01");
  assert.equal(formatHoldCountdown(-1), "0:00");
});
