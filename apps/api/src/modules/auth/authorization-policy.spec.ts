import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import {
  AuthorizationPolicyService,
  effectiveRoles,
  expandOwnerAdminRoles,
  isEffectiveAt,
} from "./authorization-policy.service";

const now = new Date("2030-01-01T12:00:00.000Z");

test("Owner and Admin expand to Finance and InventoryManager without SuperAdmin", () => {
  const roles = expandOwnerAdminRoles([UserRole.Owner]);
  assert.ok(roles.includes(UserRole.Finance));
  assert.ok(roles.includes(UserRole.InventoryManager));
  assert.ok(!roles.includes(UserRole.SuperAdmin));
});

test("location-scoped assignments apply only at their assigned location", () => {
  const assignments = [
    { role: UserRole.Finance, locationId: "location-a", effectiveFrom: new Date("2029-01-01"), effectiveTo: null, revokedAt: null },
    { role: UserRole.Receptionist, locationId: null, effectiveFrom: new Date("2029-01-01"), effectiveTo: null, revokedAt: null },
  ];
  assert.deepEqual(effectiveRoles(assignments, now, "location-b"), [UserRole.Receptionist]);
  assert.deepEqual(new Set(effectiveRoles(assignments, now, "location-a")), new Set([UserRole.Finance, UserRole.Receptionist]));
  assert.deepEqual(effectiveRoles(assignments, now), [UserRole.Receptionist]);
});

test("expired and revoked assignments grant no role", () => {
  assert.equal(isEffectiveAt({ effectiveFrom: new Date("2029-01-01"), effectiveTo: new Date("2029-12-31"), revokedAt: null }, now), false);
  assert.equal(isEffectiveAt({ effectiveFrom: new Date("2029-01-01"), effectiveTo: null, revokedAt: new Date("2029-12-01") }, now), false);
});

test("legacy scalar roles are quarantined unless dual-read is explicitly enabled", async () => {
  const policy = new AuthorizationPolicyService({
    organizationMembership: { findUnique: async () => null },
    user: { findFirst: async () => ({ role: UserRole.Receptionist }) },
  } as never);
  const previous = process.env.ROLE_ASSIGNMENT_DUAL_READ;
  delete process.env.ROLE_ASSIGNMENT_DUAL_READ;
  try {
    assert.deepEqual(await policy.resolveContext("user-a", "clinic-a", { at: now }), { organizationId: "clinic-a", roles: [], roleScopes: [], source: "none" });
    process.env.ROLE_ASSIGNMENT_DUAL_READ = "true";
    const context = await policy.resolveContext("user-a", "clinic-a", { at: now });
    assert.equal(context.source, "legacy-quarantined");
    assert.deepEqual(context.roles, [UserRole.Receptionist]);
  } finally {
    if (previous === undefined) delete process.env.ROLE_ASSIGNMENT_DUAL_READ;
    else process.env.ROLE_ASSIGNMENT_DUAL_READ = previous;
  }
});

test("privilege grants require attributable actor and reason", async () => {
  const policy = new AuthorizationPolicyService({} as never);
  await assert.rejects(
    policy.assignRole({ organizationId: "clinic-a", userId: "user-a", role: UserRole.Finance, actorUserId: "", reason: "" }),
    BadRequestException,
  );
});
