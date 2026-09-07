import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { WorkspaceBootstrapService } from "./workspace-bootstrap.service";

const actor = {
  id: "user-a",
  organizationId: "clinic-a",
  name: "Clinic A Provider",
  email: "provider@clinic-a.test",
  role: UserRole.Provider,
  providerId: "provider-a",
};

test("workspace bootstrap scopes its organization and locations to the authenticated tenant", async () => {
  const queries: Array<{ delegate: string; query: unknown }> = [];
  const prisma = {
    organization: {
      findFirst: async (query: unknown) => {
        queries.push({ delegate: "organization", query });
        return {
          id: "clinic-a",
          name: "Clinic A",
          businessType: "dental_clinic",
          timezone: "Asia/Kathmandu",
          primaryCalendar: "AD",
        };
      },
    },
    location: {
      findMany: async (query: unknown) => {
        queries.push({ delegate: "location", query });
        return [
          { id: "location-a", name: "Main Clinic", timezone: "Asia/Kathmandu" },
          { id: "location-b", name: "Finance Clinic", timezone: "Asia/Kathmandu" },
        ];
      },
    },
  };
  const service = new WorkspaceBootstrapService(
    prisma as never,
    {
      requireSession: async () => ({
        ...actor,
        effectiveRoles: [UserRole.Provider, UserRole.Finance],
        effectiveRoleScopes: [
          { role: UserRole.Provider, locationId: "location-a" },
          { role: UserRole.Finance, locationId: "location-b" },
        ],
        authorizationRoleSource: "assignment_policy",
      }),
    } as never,
  );

  const result = await service.getBootstrap(actor);

  assert.deepEqual(queries, [
    {
      delegate: "organization",
      query: {
        where: { id: "clinic-a", status: "Active" },
        select: { id: true, name: true, businessType: true, timezone: true, primaryCalendar: true },
      },
    },
    {
      delegate: "location",
      query: {
        where: { organizationId: "clinic-a", isActive: true, id: { in: ["location-a", "location-b"] } },
        select: { id: true, name: true, timezone: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      },
    },
  ]);
  assert.deepEqual(result.locations, [
    {
      id: "location-a",
      name: "Main Clinic",
      timezone: "Asia/Kathmandu",
      canCreateAppointment: true,
      canManageInventory: false,
    },
    {
      id: "location-b",
      name: "Finance Clinic",
      timezone: "Asia/Kathmandu",
      canCreateAppointment: false,
      canManageInventory: false,
    },
  ]);
  assert.deepEqual(result.context.actor, {
    id: "user-a",
    name: "Clinic A Provider",
    providerId: "provider-a",
    roles: [UserRole.Provider, UserRole.Finance],
    roleSource: "assignment_policy",
  });
  assert.deepEqual(result.user, {
    id: "user-a",
    organizationId: "clinic-a",
    name: "Clinic A Provider",
    email: "provider@clinic-a.test",
    role: UserRole.Provider,
    effectiveRoles: [UserRole.Provider, UserRole.Finance],
    providerId: "provider-a",
  });
  assert.deepEqual(result.context.capabilities, {
    canCreateAppointment: true,
    canCreateClient: true,
    canAccessInventory: false,
    canAccessStaff: false,
    canAccessSettings: false,
  });
});

test("workspace bootstrap has a minimal projection and no operational collections", async () => {
  const service = new WorkspaceBootstrapService(
    {
      organization: {
        findFirst: async () => ({
          id: "clinic-a",
          name: "Clinic A",
          businessType: "dental_clinic",
          timezone: "Asia/Kathmandu",
          primaryCalendar: "BS",
          email: "must-not-leak@clinic-a.test",
          phone: "must-not-leak",
        }),
      },
      location: {
        findMany: async () => [{ id: "location-a", name: "Main Clinic", timezone: "Asia/Kathmandu", address: "must-not-leak" }],
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.getBootstrap(actor);

  assert.deepEqual(Object.keys(result).sort(), ["context", "locations", "user"]);
  assert.deepEqual(Object.keys(result.context).sort(), [
    "actor",
    "capabilities",
    "organization",
  ]);
  assert.deepEqual(Object.keys(result.context.actor).sort(), ["id", "name", "providerId", "roleSource", "roles"]);
  assert.deepEqual(Object.keys(result.context.organization).sort(), [
    "businessType",
    "id",
    "name",
    "primaryCalendar",
    "timezone",
  ]);
  assert.deepEqual(Object.keys(result.locations[0]).sort(), [
    "canCreateAppointment",
    "canManageInventory",
    "id",
    "name",
    "timezone",
  ]);
  for (const forbidden of ["appointments", "clients", "customers", "billing", "invoices", "followUps", "records", "notifications"]) {
    assert.equal(forbidden in result, false);
  }
});

test("workspace bootstrap rejects non-clinic users before querying Prisma", async () => {
  let queried = false;
  const service = new WorkspaceBootstrapService(
    {
      organization: { findFirst: async () => { queried = true; } },
      location: { findMany: async () => { queried = true; } },
    } as never,
    { requireSession: async () => ({ ...actor, role: UserRole.Client }) } as never,
  );

  await assert.rejects(service.getBootstrap(actor), ForbiddenException);
  assert.equal(queried, false);
});

test("workspace bootstrap permits finance-only clinic members", async () => {
  const service = new WorkspaceBootstrapService(
    {
      organization: {
        findFirst: async () => ({
          id: "clinic-a",
          name: "Clinic A",
          businessType: "dental_clinic",
          timezone: "Asia/Kathmandu",
          primaryCalendar: "AD",
        }),
      },
      location: { findMany: async () => [] },
    } as never,
    {
      requireSession: async () => ({
        ...actor,
        role: UserRole.Finance,
        effectiveRoles: [UserRole.Finance],
        effectiveRoleScopes: [{ role: UserRole.Finance, locationId: "location-a" }],
      }),
    } as never,
  );

  const result = await service.getBootstrap(actor);
  assert.deepEqual(result.context.actor.roles, [UserRole.Finance]);
  assert.equal(result.context.capabilities.canCreateAppointment, false);
});

test("workspace bootstrap permits a location-scoped Inventory Manager and exposes only Inventory capability", async () => {
  const inventoryActor = {
    ...actor,
    role: UserRole.InventoryManager,
    effectiveRoles: [],
    effectiveRoleScopes: [
      { role: UserRole.InventoryManager, locationId: "location-a" },
    ],
    authorizationRoleSource: "assignment_policy" as const,
  };
  const service = new WorkspaceBootstrapService(
    {
      organization: {
        findFirst: async () => ({
          id: "clinic-a",
          name: "Clinic A",
          businessType: "dental_clinic",
          timezone: "Asia/Kathmandu",
          primaryCalendar: "AD",
        }),
      },
      location: {
        findMany: async () => [
          { id: "location-a", name: "Main Clinic", timezone: "Asia/Kathmandu" },
        ],
      },
    } as never,
    { requireSession: async () => inventoryActor } as never,
  );

  const result = await service.getBootstrap(inventoryActor);
  assert.equal(result.context.capabilities.canAccessInventory, true);
  assert.equal(result.context.capabilities.canCreateAppointment, false);
  assert.equal(result.locations[0]?.canManageInventory, true);
});
