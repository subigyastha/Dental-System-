import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import type { AuthSession } from "../auth/auth.service";
import { ClinicSettingsService } from "./clinic-settings.service";

const settingsRow = {
  businessDayStartsAt: "08:00",
  businessDayEndsAt: "18:00",
  defaultBufferMinutes: 10,
  bookingHoldMinutes: 3,
  slotStartIntervalMinutes: 15,
  scheduleConfigurationVersion: 2,
  reminderLeadMinutes: 1440,
};

const organization = {
  id: "clinic-a",
  name: "Clinic A",
  email: null,
  phone: null,
  address: null,
  timezone: "Asia/Kathmandu",
  settings: settingsRow,
};

function actor(role: UserRole, locationId: string | null): AuthSession {
  return {
    id: "actor-a",
    organizationId: "clinic-a",
    name: "Actor",
    email: "actor@example.test",
    role,
    effectiveRoles: [role],
    effectiveRoleScopes: [{ role, locationId }],
  };
}

function serviceFor(session: AuthSession) {
  return new ClinicSettingsService(
    { organization: { findFirst: async () => organization } } as never,
    { requireSession: async () => session } as never,
    { invalidateOrganizationSchedulePlanning: () => undefined } as never,
  );
}

test("organization Owner receives AD-first settings and slot control", async () => {
  const result = await serviceFor(actor(UserRole.Owner, null)).get();
  assert.equal(result.capabilities.canManageSlotInterval, true);
  assert.equal(result.organization.primaryCalendar, "AD");
  assert.equal(result.scheduling.allowOverlaps, false);
  assert.equal(result.scheduling.slotStartIntervalMinutes, 15);
});

test("location-scoped Admin cannot read organization settings", async () => {
  await assert.rejects(
    serviceFor(actor(UserRole.Admin, "location-a")).get(),
    ForbiddenException,
  );
});

test("organization Admin cannot change the Owner-controlled slot interval", async () => {
  await assert.rejects(
    serviceFor(actor(UserRole.Admin, null)).update({
      name: "Clinic A",
      businessDayStartsAt: "08:00",
      businessDayEndsAt: "18:00",
      defaultBufferMinutes: 10,
      bookingHoldMinutes: 3,
      slotStartIntervalMinutes: 30,
      reminderLeadMinutes: 1440,
    }),
    ForbiddenException,
  );
});
