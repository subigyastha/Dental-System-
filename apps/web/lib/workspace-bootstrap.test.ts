import assert from "node:assert/strict";
import test from "node:test";

import {
  minimalOperationalData,
  unwrapWorkspaceBootstrap,
  type WorkspaceBootstrap,
} from "./workspace-bootstrap";

const bootstrap: WorkspaceBootstrap = {
  user: {
    id: "user-a",
    organizationId: "clinic-a",
    name: "Clinic Owner",
    email: "owner@clinic-a.test",
    role: "Owner",
    effectiveRoles: ["Owner"],
  },
  context: {
    capabilities: {
      canCreateAppointment: true,
      canCreateClient: true,
      canAccessInventory: true,
      canAccessStaff: true,
      canAccessSettings: true,
    },
    organization: {
      id: "clinic-a",
      name: "Clinic A",
      timezone: "Asia/Kathmandu",
      primaryCalendar: "AD",
    },
    actor: {
      id: "user-a",
      name: "Clinic Owner",
      roles: ["Owner"],
      roleSource: "assignment_policy",
    },
  },
  locations: [
    {
      id: "location-a",
      name: "Main clinic",
      timezone: "Asia/Kathmandu",
      canCreateAppointment: true,
      canManageInventory: true,
    },
  ],
};

test("minimal workspace data contains shell context but no domain collections", () => {
  const data = minimalOperationalData(bootstrap);

  assert.equal(data.organization.id, "clinic-a");
  assert.equal(data.locations[0]?.organizationId, "clinic-a");
  assert.equal(data.locations[0]?.isActive, true);
  assert.deepEqual(data.appointments, []);
  assert.deepEqual(data.customers, []);
  assert.deepEqual(data.followUps, []);
  assert.deepEqual(data.visitReports, []);
});

test("workspace bootstrap accepts only the v1 envelope", () => {
  assert.equal(
    unwrapWorkspaceBootstrap({
      data: bootstrap,
      meta: { apiVersion: "v1" },
    }),
    bootstrap,
  );
  assert.throws(
    () =>
      unwrapWorkspaceBootstrap({
        data: bootstrap,
        meta: { apiVersion: "v2" as "v1" },
      }),
    /unsupported response/,
  );
});
