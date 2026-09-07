import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { validate } from "class-validator";

import { adDateKeyInTimeZone } from "../../scheduling/ad-date-key";
import { ListProviderSlotsDto } from "./list-provider-slots.dto";

async function validateDate(date: string) {
  const dto = new ListProviderSlotsDto();
  dto.organizationId = "clinic-a";
  dto.date = date;
  return validate(dto);
}

test("provider slots DTO accepts a real Gregorian leap day", async () => {
  assert.deepEqual(await validateDate("2024-02-29"), []);
});

test("provider slots DTO rejects malformed and impossible AD dates", async () => {
  for (const date of [
    "2026-2-03",
    "2026/02/03",
    "2026-02-30",
    "2025-02-29",
    "1900-02-29",
    "0000-01-01",
  ]) {
    const errors = await validateDate(date);
    assert.equal(errors.length, 1, `${date} should be rejected`);
    assert.match(
      Object.values(errors[0].constraints ?? {}).join(" "),
      /real Gregorian AD date/,
    );
  }
});

test("Nepal AD date uses the clinic day instead of the UTC day", () => {
  assert.equal(
    adDateKeyInTimeZone(new Date("2026-07-26T18:30:00.000Z")),
    "2026-07-27",
  );
});
