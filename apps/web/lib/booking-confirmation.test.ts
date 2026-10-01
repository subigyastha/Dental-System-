import assert from "node:assert/strict";
import test from "node:test";

import { rememberCsrfToken } from "./api-client";
import {
  confirmBooking,
  confirmationPayloadFingerprint,
  type ConfirmBookingRequest,
} from "./booking-confirmation";

const payload: ConfirmBookingRequest = {
  draftId: "00000000-0000-4000-8000-000000000001",
  locationId: "location-a",
  providerId: "provider-a",
  serviceId: "service-a",
  startsAtIso: "2030-01-01T03:15:00.000Z",
  priority: "Normal",
  client: { mode: "existing", clientId: "client-a" },
};

test("confirmation retries preserve an exact payload fingerprint", () => {
  assert.equal(
    confirmationPayloadFingerprint(payload),
    confirmationPayloadFingerprint({ ...payload }),
  );
});

test("changed confirmation content produces a different fingerprint", () => {
  assert.notEqual(
    confirmationPayloadFingerprint(payload),
    confirmationPayloadFingerprint({
      ...payload,
      priority: "Urgent",
    }),
  );
});

test("a confirmation retry reuses the exact payload and idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const key = "confirmation-response-lost";
  let callCount = 0;
  rememberCsrfToken("test-csrf");
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), init });
    callCount += 1;
    if (callCount === 1) throw new TypeError("Response lost after commit");
    return Response.json({
      data: {
        confirmationId: "confirmation-a",
        appointment: { id: "appointment-a" },
        client: { id: "client-a" },
        hold: { id: "hold-a", status: "consumed" },
        replayed: true,
      },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(confirmBooking(payload, key), TypeError);
    assert.equal(requests.length, 1, "the transport does not invent a new confirmation attempt");

    const result = await confirmBooking(payload, key);
    assert.equal(result.replayed, true);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((request) => request.url), [
      "/api/v1/booking/confirm",
      "/api/v1/booking/confirm",
    ]);
    assert.deepEqual(requests.map((request) => request.init?.body), [
      JSON.stringify(payload),
      JSON.stringify(payload),
    ]);
    assert.deepEqual(requests.map((request) => new Headers(request.init?.headers).get("Idempotency-Key")), [key, key]);
  } finally {
    globalThis.fetch = originalFetch;
    rememberCsrfToken();
  }
});
