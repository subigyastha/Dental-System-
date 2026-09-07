import assert from "node:assert/strict";
import test from "node:test";

import {
  scheduleOperationalData,
  unwrapScheduleBootstrap,
  type ScheduleBootstrap,
} from "./schedule-bootstrap";
import type { WorkspaceBootstrap } from "./workspace-bootstrap";

const workspace = {
  user: {
    id: "user-a",
    organizationId: "clinic-a",
    name: "Admin",
    email: "admin@clinic-a.test",
    role: "Admin",
    effectiveRoles: ["Admin"],
  },
  context: {
    capabilities: { canCreateAppointment: true, canCreateClient: true, canAccessInventory: true, canAccessStaff: true, canAccessSettings: true },
    organization: {
      id: "clinic-a",
      name: "Clinic A",
      timezone: "Asia/Kathmandu",
      primaryCalendar: "AD",
    },
    actor: { id: "user-a", name: "Admin", roles: ["Admin"], roleSource: "assignment_policy" },
  },
  locations: [],
} satisfies WorkspaceBootstrap;

const schedule = {
  context: { organizationId: "clinic-a", generatedAtIso: "2030-01-01T00:00:00.000Z" },
  providers: [],
  services: [],
} satisfies ScheduleBootstrap;

test("schedule bootstrap adds only schedule reference data to the shell", () => {
  const data = scheduleOperationalData(workspace, schedule);
  assert.equal(data.dataScope, "schedule");
  assert.deepEqual(data.customers, []);
  assert.deepEqual(data.appointments, []);
  assert.deepEqual(data.staff, []);
  assert.deepEqual(data.followUps, []);
});

test("schedule bootstrap rejects a cross-workspace response", () => {
  assert.throws(
    () => scheduleOperationalData(workspace, {
      ...schedule,
      context: { ...schedule.context, organizationId: "clinic-b" },
    }),
    /does not belong/,
  );
});

test("schedule bootstrap accepts only the v1 envelope", () => {
  assert.equal(unwrapScheduleBootstrap({ data: schedule, meta: { apiVersion: "v1" } }), schedule);
  assert.throws(
    () => unwrapScheduleBootstrap({ data: schedule, meta: { apiVersion: "v2" as "v1" } }),
    /unsupported response/,
  );
});
