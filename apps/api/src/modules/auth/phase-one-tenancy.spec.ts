import assert from "node:assert/strict";
import test from "node:test";

import { NotFoundException } from "@nestjs/common";

import type { AuthSession } from "./auth.service";
import { CommunicationsService } from "../communications/communications.service";
import { FollowupsService } from "../followups/followups.service";
import { OperationalDataService } from "../operational-data/operational-data.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { SystemController } from "../system/system.controller";

const clinicAActor: AuthSession = {
  id: "staff-a",
  organizationId: "clinic-a",
  name: "Clinic A Owner",
  email: "owner-a@example.test",
  role: "Owner",
};

const auth = {
  requireSession: async () => clinicAActor,
} as never;

test("organization update rejects a caller-supplied Clinic B id before querying", async () => {
  let queried = false;
  const service = new OrganizationsService(
    {
      organization: { findUnique: async () => { queried = true; return null; } },
    } as never,
    auth,
  );

  await assert.rejects(
    service.update("clinic-b", {} as never, "Bearer clinic-a-token"),
    NotFoundException,
  );
  assert.equal(queried, false);
});

test("communications lookup scopes a guessed Clinic B appointment to Clinic A", async () => {
  let where: unknown;
  const service = new CommunicationsService(
    {
      appointment: {
        findFirst: async (args: { where: unknown }) => { where = args.where; return null; },
      },
    } as never,
    auth,
  );

  await assert.rejects(
    service.create(
      { appointmentId: "appointment-b", customerId: "client-b", channel: "SMS", direction: "Outbound", summary: "Reminder" },
      "Bearer clinic-a-token",
    ),
    NotFoundException,
  );
  assert.deepEqual(where, { id: "appointment-b", organizationId: "clinic-a" });
});

test("follow-up close scopes a guessed Clinic B task to Clinic A", async () => {
  let where: unknown;
  const service = new FollowupsService(
    {
      followUpTask: {
        findFirst: async (args: { where: unknown }) => { where = args.where; return null; },
      },
    } as never,
    auth,
  );

  await assert.rejects(service.close("follow-up-b", "Bearer clinic-a-token"), NotFoundException);
  assert.deepEqual(where, { id: "follow-up-b", organizationId: "clinic-a" });
});

test("operational data selects only the authenticated organization", async () => {
  let where: unknown;
  const service = new OperationalDataService(
    {
      organization: {
        findUnique: async (args: { where: unknown }) => { where = args.where; return null; },
      },
    } as never,
    auth,
  );

  assert.equal(await service.getOperationalData("Bearer clinic-a-token"), null);
  assert.deepEqual(where, { id: "clinic-a" });
});

test("system status counts only the authenticated organization", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/clinicflow_test";
  let where: unknown;
  const controller = new SystemController(
    {
      organization: {
        count: async (args: { where: unknown }) => { where = args.where; return 1; },
      },
    } as never,
    auth,
  );

  try {
    const status = await controller.status("Bearer clinic-a-token");
    assert.equal(status.organizationCount, 1);
    assert.deepEqual(where, { id: "clinic-a" });
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});
