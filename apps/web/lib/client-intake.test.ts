import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalPhoneDigits,
  clientIntakeFingerprint,
  validateMinimalClientIntake,
} from "./client-intake";

const intake = {
  name: " Asha   Rai ",
  phone: "+977 980-000-0000",
  address: " Kathmandu ",
  priorVisitedClinic: false,
};

test("minimal Client intake validates name and canonical phone length", () => {
  assert.equal(validateMinimalClientIntake(intake), null);
  assert.match(
    validateMinimalClientIntake({ ...intake, phone: "123" }) ?? "",
    /7 to 15/,
  );
});

test("match-review fingerprint changes whenever identity input changes", () => {
  const original = clientIntakeFingerprint(intake);
  assert.notEqual(
    original,
    clientIntakeFingerprint({ ...intake, phone: "9800000001" }),
  );
  assert.notEqual(
    original,
    clientIntakeFingerprint({ ...intake, name: "Bina Rai" }),
  );
});

test("Nepal local and country-code phone formats compare as one number", () => {
  assert.equal(
    canonicalPhoneDigits("980-000-0000"),
    canonicalPhoneDigits("+977 980-000-0000"),
  );
});
