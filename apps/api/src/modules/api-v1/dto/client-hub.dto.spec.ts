import assert from "node:assert/strict";
import test from "node:test";

import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateClientDto } from "./client-hub.dto";

const valid = {
  name: "Asha Rai",
  phone: "9800000000",
  email: "asha@example.test",
  dateOfBirthIso: "1995-06-12",
  candidateSetVersion: "123456789012345678901234",
};

test("Client intake accepts a bounded email and AD date-only value", async () => {
  assert.equal(
    (await validate(plainToInstance(CreateClientDto, valid))).length,
    0,
  );
});

test("Client intake rejects malformed email and timestamp-valued DOB", async () => {
  const errors = await validate(
    plainToInstance(CreateClientDto, {
      ...valid,
      email: "not-an-email",
      dateOfBirthIso: "1995-06-12T00:00:00.000Z",
    }),
  );
  assert.ok(errors.some((error) => error.property === "email"));
  assert.ok(errors.some((error) => error.property === "dateOfBirthIso"));
});
