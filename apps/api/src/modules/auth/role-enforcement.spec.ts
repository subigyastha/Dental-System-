import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { AuthService, ROLE_ASSIGNMENT_ENFORCEMENT_ENV } from "./auth.service";
import { assertClinicAdmin, assertClinicOperator, assertClinicOperatorForLocation, assertFinanceOperator } from "./authz";
import { expandOwnerAdminRoles } from "./authorization-policy.service";

const baseSession = {
  id: "user-a",
  organizationId: "clinic-a",
  name: "User A",
  email: "user-a@example.test",
  role: UserRole.Receptionist,
};

function withRoleFlags(callback: () => Promise<void> | void, options: { enforcement?: string; dualRead?: string } = {}) {
  const previousEnforcement = process.env[ROLE_ASSIGNMENT_ENFORCEMENT_ENV];
  const previousDualRead = process.env.ROLE_ASSIGNMENT_DUAL_READ;
  if (options.enforcement === undefined) delete process.env[ROLE_ASSIGNMENT_ENFORCEMENT_ENV];
  else process.env[ROLE_ASSIGNMENT_ENFORCEMENT_ENV] = options.enforcement;
  if (options.dualRead === undefined) delete process.env.ROLE_ASSIGNMENT_DUAL_READ;
  else process.env.ROLE_ASSIGNMENT_DUAL_READ = options.dualRead;
  return Promise.resolve(callback()).finally(() => {
    if (previousEnforcement === undefined) delete process.env[ROLE_ASSIGNMENT_ENFORCEMENT_ENV];
    else process.env[ROLE_ASSIGNMENT_ENFORCEMENT_ENV] = previousEnforcement;
    if (previousDualRead === undefined) delete process.env.ROLE_ASSIGNMENT_DUAL_READ;
    else process.env.ROLE_ASSIGNMENT_DUAL_READ = previousDualRead;
  });
}

test("assignment enforcement uses the complete multi-role union", async () => withRoleFlags(async () => {
  const auth = new AuthService({} as never, {
    resolveContext: async () => ({ organizationId: "clinic-a", roles: [UserRole.Provider, UserRole.Finance], source: "assignments" }),
  } as never);
  const session = await auth.requireSession(baseSession);

  assert.deepEqual(session.effectiveRoles, [UserRole.Provider, UserRole.Finance]);
  assert.doesNotThrow(() => assertClinicOperator(session));
  assert.doesNotThrow(() => assertFinanceOperator(session));
}, { enforcement: "true" }));

test("revoked or inactive membership fails closed under assignment enforcement", async () => withRoleFlags(async () => {
  const auth = new AuthService({} as never, {
    resolveContext: async () => ({ organizationId: "clinic-a", roles: [], source: "assignments" }),
  } as never);
  const session = await auth.requireSession(baseSession);

  assert.deepEqual(session.effectiveRoles, []);
  assert.throws(() => assertClinicOperator(session), ForbiddenException);
}, { enforcement: "true" }));

test("owner expansion remains available through assignment roles", async () => withRoleFlags(async () => {
  const roles = expandOwnerAdminRoles([UserRole.Owner]);
  const auth = new AuthService({} as never, {
    resolveContext: async () => ({ organizationId: "clinic-a", roles, source: "assignments" }),
  } as never);
  const session = await auth.requireSession({ ...baseSession, role: UserRole.Receptionist });

  assert.ok(session.effectiveRoles?.includes(UserRole.InventoryManager));
  assert.doesNotThrow(() => assertClinicAdmin(session));
  assert.doesNotThrow(() => assertFinanceOperator(session));
}, { enforcement: "true" }));

test("legacy scalar behavior is preserved by default and policy fallback is explicit", async () => {
  await withRoleFlags(async () => {
    const auth = new AuthService({} as never, {
      resolveContext: async () => ({ organizationId: "clinic-a", roles: [], source: "none" }),
    } as never);
    const session = await auth.requireSession(baseSession);
    assert.deepEqual(session.effectiveRoles, [UserRole.Receptionist]);
    assert.doesNotThrow(() => assertClinicOperator(session));
  });

  await withRoleFlags(async () => {
    const auth = new AuthService({} as never, {
      resolveContext: async () => ({ organizationId: "clinic-a", roles: [], source: "none" }),
    } as never);
    const session = await auth.requireSession(baseSession);
    assert.deepEqual(session.effectiveRoles, []);
    assert.throws(() => assertClinicOperator(session), ForbiddenException);
  }, { enforcement: "true" });

  await withRoleFlags(async () => {
    const auth = new AuthService({} as never, {
      resolveContext: async () => ({ organizationId: "clinic-a", roles: [UserRole.Receptionist], source: "legacy-quarantined" }),
    } as never);
    const session = await auth.requireSession(baseSession);
    assert.deepEqual(session.effectiveRoles, [UserRole.Receptionist]);
    assert.equal(session.authorizationRoleSource, "legacy_dual_read");
  }, { enforcement: "true", dualRead: "true" });
});

test("a Location A assignment cannot access Location B or organization-scoped records", () => {
  const locationASession = {
    ...baseSession,
    effectiveRoles: [],
    effectiveRoleScopes: [{ role: UserRole.Provider, locationId: "location-a" }],
    authorizationRoleSource: "assignment_policy" as const,
  };
  assert.doesNotThrow(() => assertClinicOperatorForLocation(locationASession, "location-a"));
  assert.throws(() => assertClinicOperatorForLocation(locationASession, "location-b"), ForbiddenException);
  assert.throws(() => assertClinicOperator(locationASession), ForbiddenException);
});
