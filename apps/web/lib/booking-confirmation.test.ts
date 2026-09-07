import assert from "node:assert/strict";
import test from "node:test";

import {
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
