import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { RoleGovernanceService } from "./role-governance.service";

const owner = { id: "owner-a", organizationId: "clinic-a", name: "Clinic A Owner", email: "owner-a@example.test", role: UserRole.Owner };

function createService() {
  const auditEvents: Array<Record<string, unknown>> = [];
  const prisma = {
    user: { findFirst: async () => ({ id: "staff-b" }) },
    organizationMembership: { findUnique: async () => null },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { auditEvents.push(data); return { id: "audit" }; } },
  } as never;
  const policy = {
    assignRole: async () => ({ id: "assignment-b", membershipId: "membership-b" }),
    revokeRoleAssignment: async () => ({ id: "assignment-b" }),
    revokeMembership: async () => ({ id: "membership-b" }),
  } as never;
  return { service: new RoleGovernanceService(prisma, { requireSession: async (reference: unknown) => reference ?? owner } as never, policy), auditEvents };
}

test("owner role grant derives organization from the session and writes immutable audit events", async () => {
  const { service, auditEvents } = createService();
  await service.assign({ userId: "staff-b", role: UserRole.Finance, reason: "Assign billing lead" }, owner);
  assert.equal(auditEvents.length, 2);
  assert.equal(auditEvents[0].organizationId, "clinic-a");
  assert.equal(auditEvents[0].actorId, "owner-a");
  assert.equal(auditEvents[0].entityType, "role_assignment");
  assert.deepEqual(auditEvents[0].newValue, { userId: "staff-b", role: UserRole.Finance, locationId: null, reason: "Assign billing lead" });
});

test("users cannot grant themselves a role", async () => {
  const { service } = createService();
  await assert.rejects(service.assign({ userId: "owner-a", role: UserRole.Finance, reason: "Self escalation" }, owner), ForbiddenException);
});

test("an Admin cannot grant the Owner role", async () => {
  const admin = { ...owner, id: "admin-a", role: UserRole.Admin };
  const { service } = createService();
  await assert.rejects(service.assign({ userId: "staff-b", role: UserRole.Owner, reason: "Escalation" }, admin), ForbiddenException);
});
