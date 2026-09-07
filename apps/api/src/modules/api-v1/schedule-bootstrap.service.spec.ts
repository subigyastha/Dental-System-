import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { ScheduleBootstrapService } from "./schedule-bootstrap.service";

const provider = {
  id: "provider-a",
  organizationId: "clinic-a",
  userId: null,
  displayName: "Dr A",
  roleLabel: "Dentist",
  specialty: "General",
  status: "Available",
  color: "#0f766e",
  createdAt: new Date("2030-01-01T00:00:00.000Z"),
  updatedAt: new Date("2030-01-01T00:00:00.000Z"),
  availability: [],
  recurringBlocks: [],
  blockedTimes: [],
  providerServices: [],
};

test("schedule bootstrap is bounded, tenant-scoped, and location-scoped", async () => {
  const observed: unknown[] = [];
  const service = new ScheduleBootstrapService(
    {
      provider: {
        findMany: async (query: unknown) => {
          observed.push(query);
          return [provider, { ...provider, id: "provider-b", displayName: "Dr B" }];
        },
      },
      service: {
        findMany: async (query: unknown) => {
          observed.push(query);
          return [{ id: "service-a", name: "Exam", category: "Care", durationMinutes: 30, bufferMinutes: 10 }];
        },
      },
    } as never,
    {
      requireSession: async () => ({
        id: "user-a",
        organizationId: "clinic-a",
        name: "Dr A",
        email: "dr-a@clinic.test",
        role: UserRole.Provider,
        providerId: "provider-a",
        effectiveRoles: [UserRole.Provider],
        effectiveRoleScopes: [{ role: UserRole.Provider, locationId: "location-a" }],
      }),
    } as never,
  );

  const result = await service.getBootstrap();
  assert.equal(result.providers.length, 2, "providers may view their colleagues' schedules");
  assert.equal(result.services.length, 1);
  assert.equal(result.context.organizationId, "clinic-a");

  const serialized = JSON.stringify(observed);
  assert.match(serialized, /"organizationId":"clinic-a"/);
  assert.match(serialized, /"locationId":\{"in":\["location-a"\]\}/);
  assert.doesNotMatch(serialized, /customer|appointment|staff|record/i);
});

test("organization-wide operator access does not add a location filter", async () => {
  let providerQuery: unknown;
  const service = new ScheduleBootstrapService(
    {
      provider: { findMany: async (query: unknown) => { providerQuery = query; return []; } },
      service: { findMany: async () => [] },
    } as never,
    {
      requireSession: async () => ({
        id: "admin-a",
        organizationId: "clinic-a",
        name: "Admin",
        email: "admin@clinic.test",
        role: UserRole.Admin,
        effectiveRoles: [UserRole.Admin],
        effectiveRoleScopes: [{ role: UserRole.Admin, locationId: null }],
      }),
    } as never,
  );

  await service.getBootstrap();
  const include = (providerQuery as { include: { availability: { where: unknown } } }).include;
  assert.deepEqual(include.availability.where, {});
});

test("summary schedule bootstrap skips Provider schedule relation reads", async () => {
  let providerQuery: unknown;
  const service = new ScheduleBootstrapService(
    {
      provider: {
        findMany: async (query: unknown) => {
          providerQuery = query;
          return [{
            id: "provider-a",
            userId: null,
            displayName: "Dr A",
            roleLabel: "Dentist",
            specialty: "General",
            status: "Available",
            color: "#0f766e",
          }];
        },
      },
      providerService: {
        findMany: async () => [{ providerId: "provider-a", serviceId: "service-a" }],
      },
      service: { findMany: async () => [] },
    } as never,
    {
      requireSession: async () => ({
        id: "admin-a",
        organizationId: "clinic-a",
        name: "Admin",
        email: "admin@clinic.test",
        role: UserRole.Admin,
        effectiveRoles: [UserRole.Admin],
      }),
    } as never,
  );

  const result = await service.getBootstrap(undefined, "summary");

  assert.equal("include" in (providerQuery as object), false);
  assert.deepEqual(result.providers[0]?.availability, []);
  assert.deepEqual(result.providers[0]?.recurringBlocks, []);
  assert.deepEqual(result.providers[0]?.blockedTimes, []);
  assert.deepEqual(result.providers[0]?.serviceIds, ["service-a"]);
});

test("finance-only actors cannot load schedule reference data", async () => {
  const service = new ScheduleBootstrapService(
    {} as never,
    {
      requireSession: async () => ({
        id: "finance-a",
        organizationId: "clinic-a",
        name: "Finance",
        email: "finance@clinic.test",
        role: UserRole.Finance,
        effectiveRoles: [UserRole.Finance],
      }),
    } as never,
  );
  await assert.rejects(service.getBootstrap(), ForbiddenException);
});
