import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import type { AuthSession } from "../auth/auth.service";
import { StaffService } from "./staff.service";

const validTestPassphrase = ["A-long", "passphrase", "for-testing"].join("-");

function serviceFor(actor: AuthSession, prisma: Record<string, unknown> = {}) {
  return new StaffService(
    prisma as never,
    { requireSession: async () => actor } as never,
  );
}

test("a location-scoped Admin cannot use organization-wide legacy Staff reads", async () => {
  const actor: AuthSession = {
    id: "admin-a",
    organizationId: "clinic-a",
    name: "Location Admin",
    email: "admin@example.test",
    role: UserRole.Admin,
    effectiveRoles: [],
    effectiveRoleScopes: [{ role: UserRole.Admin, locationId: "location-a" }],
  };
  await assert.rejects(serviceFor(actor).list(false), ForbiddenException);
});

test("an organization-scoped Owner can use the retained Staff compatibility read", async () => {
  const actor: AuthSession = {
    id: "owner-a",
    organizationId: "clinic-a",
    name: "Owner",
    email: "owner@example.test",
    role: UserRole.Owner,
    effectiveRoles: [UserRole.Owner],
    effectiveRoleScopes: [{ role: UserRole.Owner, locationId: null }],
  };
  const service = serviceFor(actor, { user: { findMany: async () => [] } });
  assert.deepEqual(await service.list(false), []);
});

test("an organization-scoped Admin cannot create an Owner account", async () => {
  const actor: AuthSession = {
    id: "admin-a",
    organizationId: "clinic-a",
    name: "Organization Admin",
    email: "admin@example.test",
    role: UserRole.Admin,
    effectiveRoles: [UserRole.Admin],
    effectiveRoleScopes: [{ role: UserRole.Admin, locationId: null }],
  };
  await assert.rejects(
    serviceFor(actor).create(
      { organizationId: "clinic-a", role: UserRole.Owner } as never,
    ),
    ForbiddenException,
  );
});

test("an organization-scoped Admin cannot reset an Owner password", async () => {
  const actor: AuthSession = {
    id: "admin-a",
    organizationId: "clinic-a",
    name: "Organization Admin",
    email: "admin@example.test",
    role: UserRole.Admin,
    effectiveRoles: [UserRole.Admin],
    effectiveRoleScopes: [{ role: UserRole.Admin, locationId: null }],
  };
  const service = serviceFor(actor, {
    user: {
      findFirst: async () => ({ id: "owner-a", organizationId: "clinic-a", role: UserRole.Owner }),
    },
  });
  await assert.rejects(
    service.resetPassword("owner-a", { password: validTestPassphrase }),
    ForbiddenException,
  );
});
