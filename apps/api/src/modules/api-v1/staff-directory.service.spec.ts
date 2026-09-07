import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import type { AuthSession } from "../auth/auth.service";
import { StaffDirectoryService } from "./staff-directory.service";

const owner: AuthSession = {
  id: "owner-a",
  organizationId: "clinic-a",
  name: "Clinic Owner",
  email: "owner@example.test",
  role: UserRole.Owner,
  effectiveRoles: [UserRole.Owner],
  effectiveRoleScopes: [{ role: UserRole.Owner, locationId: null }],
};

const locationManager: AuthSession = {
  ...owner,
  id: "manager-a",
  role: UserRole.Manager,
  effectiveRoles: [],
  effectiveRoleScopes: [{ role: UserRole.Manager, locationId: "location-a" }],
};

const query = { page: 1, limit: 25, sort: "name" as const, direction: "asc" as const };

function serviceWith(prisma: Record<string, unknown>, actor: AuthSession) {
  return new StaffDirectoryService(
    prisma as never,
    { requireSession: async () => actor } as never,
  );
}

test("Finance-only actors cannot read the Staff directory", async () => {
  const finance: AuthSession = {
    ...owner,
    role: UserRole.Finance,
    effectiveRoles: [UserRole.Finance],
    effectiveRoleScopes: [{ role: UserRole.Finance, locationId: null }],
  };
  await assert.rejects(serviceWith({}, finance).list(query, finance), ForbiddenException);
});

test("location Managers get a scoped, bounded directory without Provider schedules", async () => {
  let findManyQuery: Record<string, unknown> | undefined;
  const service = serviceWith(
    {
      user: {
        findMany: async (value: Record<string, unknown>) => {
          findManyQuery = value;
          return [{
            id: "staff-a",
            name: "Local Provider",
            email: "provider@example.test",
            phone: null,
            role: UserRole.Provider,
            staffLabel: "Dentist",
            department: "Care",
            employeeCode: "EMP-1",
            status: "Active",
            isSchedulable: true,
            lastLoginAt: null,
            provider: { id: "provider-a", displayName: "Local Provider", specialty: "General", color: "#123456", status: "Available" },
            memberships: [{ roleAssignments: [{ id: "role-a", role: UserRole.Provider, locationId: "location-a", location: { id: "location-a", name: "Main" } }] }],
          }];
        },
        count: async (value: { where?: { isSchedulable?: boolean } }) =>
          value.where?.isSchedulable ? 1 : 1,
        groupBy: async () => [{ status: "Active", _count: { _all: 1 } }],
      },
    },
    locationManager,
  );

  const result = await service.list(query, locationManager);
  assert.equal(result.capabilities.canManageStaff, false);
  assert.equal(result.items[0]?.assignments[0]?.locationId, "location-a");
  assert.equal("availability" in (result.items[0]?.provider ?? {}), false);
  const serialized = JSON.stringify(findManyQuery);
  assert.match(serialized, /location-a/);
  assert.match(serialized, /"take":25/);
});

test("Owners receive management capabilities and paginated summary metadata", async () => {
  const service = serviceWith(
    {
      user: {
        findMany: async () => [],
        count: async () => 0,
        groupBy: async () => [],
      },
    },
    owner,
  );

  const result = await service.list(query, owner);
  assert.equal(result.capabilities.canManageStaff, true);
  assert.equal(result.capabilities.canManageAccess, true);
  assert.deepEqual(result.pagination, { page: 1, limit: 25, total: 0, pageCount: 1 });
});

test("Staff directory normalizes HTTP query-string pagination before Prisma", async () => {
  let findManyQuery: { skip?: number; take?: number } | undefined;
  const service = serviceWith(
    {
      user: {
        findMany: async (value: { skip?: number; take?: number }) => {
          findManyQuery = value;
          return [];
        },
        count: async () => 0,
        groupBy: async () => [],
      },
    },
    owner,
  );

  const result = await service.list(
    { ...query, page: "2", limit: "25" } as unknown as typeof query,
    owner,
  );

  assert.equal(findManyQuery?.skip, 25);
  assert.equal(findManyQuery?.take, 25);
  assert.deepEqual(result.pagination, { page: 2, limit: 25, total: 0, pageCount: 1 });
});

test("a location Manager cannot request another location", async () => {
  await assert.rejects(
    serviceWith({}, locationManager).list({ ...query, locationId: "location-b" }, locationManager),
    ForbiddenException,
  );
});
