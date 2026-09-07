import assert from "node:assert/strict";
import test from "node:test";

import { ApiRequestError } from "./api-client";
import { isProviderTimeConflict } from "./booking-error";

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
