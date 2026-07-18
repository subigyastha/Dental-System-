import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { PlatformService } from "./platform.service";

const superAdmin = {
  id: "super-admin",
  organizationId: "platform",
  name: "Platform Admin",
  email: "platform@example.test",
  role: UserRole.SuperAdmin,
};

const clinicAdmin = { ...superAdmin, id: "clinic-admin", role: UserRole.Admin };

function serviceWith(prisma: object) {
  return new PlatformService(prisma as never, {
    requireSession: async (authorization?: unknown) => authorization,
  } as never);
}

test("platform metrics are de-identified aggregates only", async () => {
  const service = serviceWith({
    organization: { count: async () => 4 },
    user: { count: async () => 23 },
    featureAdoptionEvent: {
      findMany: async () => [
        { featureKey: "whatsapp" },
        { featureKey: "whatsapp" },
        { featureKey: "inventory" },
      ],
    },
  });

  assert.deepEqual(await service.aggregateMetrics(superAdmin), {
    organizations: { total: 4 },
    activeStaff: 23,
    featureAdoption: [
      { featureKey: "whatsapp", organizationCount: 2 },
      { featureKey: "inventory", organizationCount: 1 },
    ],
  });
});

test("platform control endpoints require a Super Admin", async () => {
  const service = serviceWith({});
  await assert.rejects(service.listFeatureFlags(clinicAdmin), ForbiddenException);
});

test("global feature changes use the platform audit log, not an organization data audit", async () => {
  const platformAuditEvents: unknown[] = [];
  const service = serviceWith({
    platformFeatureFlag: {
      upsert: async () => ({ key: "whatsapp", enabled: true }),
    },
    platformAuditEvent: { create: async (value: unknown) => platformAuditEvents.push(value) },
    auditLog: { create: async () => { throw new Error("global platform change should not create organization audit data"); } },
  });

  await service.updateFeatureFlag("whatsapp", { enabled: true, reason: "Pilot approved" }, superAdmin);
  assert.equal(platformAuditEvents.length, 1);
});

test("support grants are time-bound, read-only, and exclude sensitive data domains", async () => {
  const service = serviceWith({});
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const later = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  await assert.rejects(
    service.createSupportAccessGrant({
      organizationId: "clinic-a", reason: "Troubleshoot", dataDomains: ["client_records"], startsAtIso: future, expiresAtIso: later,
    }, superAdmin),
    BadRequestException,
  );
  await assert.rejects(
    service.createSupportAccessGrant({
      organizationId: "clinic-a", reason: "Troubleshoot", dataDomains: ["operational_metadata"], startsAtIso: future, expiresAtIso: later, readOnly: false,
    }, superAdmin),
    BadRequestException,
  );
});
