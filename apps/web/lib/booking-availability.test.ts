import assert from "node:assert/strict";
import test from "node:test";

import {
  formatHoldCountdown,
  remainingHoldSeconds,
} from "./booking-availability";

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
