import assert from "node:assert/strict";
import test from "node:test";

import { isOwnerOrAdmin, isRoleActive, type RoleAssignment } from "./access-roles-panel";

const activeAssignment: RoleAssignment = {
  id: "role-1",
  role: "Finance",
  locationId: null,
  location: null,
  effectiveFrom: "2020-01-01T00:00:00.000Z",
  effectiveTo: null,
  revokedAt: null,
  revokedReason: null,
  grantReason: "Finance operations",
};

test("only Owners and Admins may open the Access & Roles data flow", () => {
  assert.equal(isOwnerOrAdmin("Owner"), true);
  assert.equal(isOwnerOrAdmin("Admin"), true);
  assert.equal(isOwnerOrAdmin("Manager"), false);
  assert.equal(isOwnerOrAdmin("Receptionist", ["Receptionist", "Admin"]), true);
  assert.equal(isOwnerOrAdmin(null), false);
});

test("effective role status excludes revoked, future, and expired assignments", () => {
  assert.equal(isRoleActive(activeAssignment), true);
  assert.equal(isRoleActive({ ...activeAssignment, revokedAt: "2025-01-01T00:00:00.000Z" }), false);
  assert.equal(isRoleActive({ ...activeAssignment, effectiveFrom: "2999-01-01T00:00:00.000Z" }), false);
  assert.equal(isRoleActive({ ...activeAssignment, effectiveTo: "2020-01-02T00:00:00.000Z" }), false);
});
