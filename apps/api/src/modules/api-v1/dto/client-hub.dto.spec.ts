import assert from "node:assert/strict";
import test from "node:test";

import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ClientDirectoryQueryDto, CreateClientDto } from "./client-hub.dto";

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

test("client directory accepts known sort/filter fields and rejects unsupported values", async () => {
  assert.equal((await validate(plainToInstance(ClientDirectoryQueryDto, { sort: "visit", direction: "desc", risk: "High priority", followUp: "due", includeTotal: "true", limit: "25" }))).length, 0);
  for (const field of ["sort", "direction", "risk", "includeTotal"]) {
    const errors = await validate(plainToInstance(ClientDirectoryQueryDto, { [field]: "unsupported" }));
    assert.ok(errors.some(error => error.property === field));
  }
});
