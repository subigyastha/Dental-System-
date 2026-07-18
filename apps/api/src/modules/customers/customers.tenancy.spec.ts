import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";

import { AuthService, type AuthSession } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { CustomersService } from "./customers.service";

/**
 * This is a service-boundary characterization test rather than an HTTP test.
 *
 * The API has no isolated database/test-application harness yet, and the
 * current bearer session implementation resolves every token through Prisma.
 * Creating a real HTTP session would therefore require a test database and
 * seeded password/session data. This fixture keeps the safety assertion
 * deterministic until UP-00 supplies that integration harness.
 */
const tenancyFixture = {
  clinicA: { id: "clinic-a" },
  clinicB: { id: "clinic-b" },
  clinicAActor: {
    id: "staff-a",
    organizationId: "clinic-a",
    name: "Clinic A Receptionist",
    email: "receptionist-a@example.test",
    role: "Receptionist",
  } satisfies AuthSession,
  clinicBClient: { id: "client-b", organizationId: "clinic-b" },
} as const;

function createService() {
  const observedCustomerLookups: Array<{ id?: string; organizationId?: string }> = [];
  const prisma = {
    customer: {
      findFirst: async (args: { where?: { id?: string; organizationId?: string } }) => {
        observedCustomerLookups.push({
          id: args.where?.id,
          organizationId: args.where?.organizationId,
        });
        return null;
      },
    },
  } as unknown as PrismaService;
  const auth = {
    requireSession: async () => tenancyFixture.clinicAActor,
  } as unknown as AuthService;

  return {
    service: new CustomersService(prisma, auth),
    observedCustomerLookups,
  };
}

test("Clinic A actor cannot read a Clinic B client", async () => {
  const { service, observedCustomerLookups } = createService();

  await assert.rejects(
    service.getOne(tenancyFixture.clinicBClient.id, "Bearer clinic-a-token"),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      return true;
    },
  );

  assert.deepEqual(observedCustomerLookups, [
    {
      id: tenancyFixture.clinicBClient.id,
      organizationId: tenancyFixture.clinicA.id,
    },
  ]);
});

test("Clinic A actor cannot create a client in Clinic B", async () => {
  const { service, observedCustomerLookups } = createService();

  await assert.rejects(
    service.create(
      {
        organizationId: tenancyFixture.clinicB.id,
        name: "Clinic B Client",
        phone: "9800000000",
        risk: "Routine",
      },
      "Bearer clinic-a-token",
    ),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      return true;
    },
  );

  assert.deepEqual(observedCustomerLookups, []);
});
