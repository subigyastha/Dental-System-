import assert from "node:assert/strict";
import test from "node:test";

import { ApiRequestError } from "./api-client";
import { isProviderTimeConflict, isUncertainBookingWriteError } from "./booking-error";

test("booking writes retain uncertainty after network loss, timeouts, and server failures", () => {
  for (const error of [
    new TypeError("Network response lost after commit"),
    new DOMException("Body read aborted", "AbortError"),
    new DOMException("Timed out", "TimeoutError"),
    new ApiRequestError("No response", 0),
    new ApiRequestError("Client deadline expired", 408),
    new ApiRequestError("Gateway failed", 502),
  ]) assert.equal(isUncertainBookingWriteError(error), true);
  for (const status of [400, 401, 403, 409, 422, 429]) {
    assert.equal(isUncertainBookingWriteError(new ApiRequestError("Rejected", status)), false);
  }
});

test("only provider time conflicts switch booking to availability", () => {
  assert.equal(
    isProviderTimeConflict(
      new ApiRequestError(
        "Slot no longer available for the selected provider",
        409,
      ),
    ),
    true,
  );
  assert.equal(
    isProviderTimeConflict(
      new ApiRequestError("Appointment is outside provider availability", 409),
    ),
    true,
  );
});

test("other booking conflicts preserve the current booking step", () => {
  assert.equal(
    isProviderTimeConflict(
      new ApiRequestError(
        "Selected client is unavailable for appointment booking",
        409,
      ),
    ),
    false,
  );
  assert.equal(
    isProviderTimeConflict(
      new ApiRequestError(
        "The selected provider is not configured to perform all requested services",
        409,
      ),
    ),
    false,
  );
  assert.equal(
    isProviderTimeConflict(new ApiRequestError("Request failed", 500)),
    false,
  );
});
