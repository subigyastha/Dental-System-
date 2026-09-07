import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

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

test("legacy appointment resolution only queries active, canonical clients", async () => {
  const observedWhere: Array<Record<string, unknown>> = [];
  let updateAttempted = false;
  const prisma = {
    customer: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        observedWhere.push(args.where);
        // Model an archived/merged record that would be returned if either
        // lifecycle predicate were omitted.
        if (
          args.where.archivedAt !== null ||
          args.where.mergedIntoCustomerId !== null
        ) {
          return {
            id: "client-a",
            organizationId: "clinic-a",
            archivedAt: new Date(),
            mergedIntoCustomerId: "client-primary",
          };
        }
        return null;
      },
      update: async () => {
        updateAttempted = true;
        return {};
      },
    },
  } as unknown as PrismaService;
  const auth = {
    requireSession: async () => tenancyFixture.clinicAActor,
  } as unknown as AuthService;
  const service = new CustomersService(prisma, auth);
  const baseResolution = {
    organizationId: "clinic-a",
    existingCustomerId: "client-a",
    name: "Existing Client",
    phone: "9800000000",
    risk: "Routine" as const,
  };

  for (const mode of ["use_existing", "update_existing"] as const) {
    await assert.rejects(
      service.resolveForAppointment({ ...baseResolution, mode }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        return true;
      },
    );
  }

  assert.deepEqual(observedWhere, [
    {
      id: "client-a",
      organizationId: "clinic-a",
      archivedAt: null,
      mergedIntoCustomerId: null,
    },
    {
      id: "client-a",
      organizationId: "clinic-a",
      archivedAt: null,
      mergedIntoCustomerId: null,
    },
  ]);
  assert.equal(updateAttempted, false);
});

test("legacy booking phone append retries an idempotent concurrent winner", async () => {
  let transactionAttempts = 0;
  let auditWrites = 0;
  const existing = {
    id: "client-a",
    organizationId: "clinic-a",
    fullName: "Existing Client",
    patientCode: "CL-000001",
    phone: "9800000000",
    email: null,
    gender: null,
    dateOfBirth: null,
    address: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    allergies: null,
    medicalNotes: null,
    riskLabel: "Routine",
    lastVisitAt: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    dentalChart: null,
  };
  const tx = {
    clientPhone: {
      findFirst: async () => ({ id: "concurrent-winner" }),
      create: async () => ({}),
    },
    auditLog: {
      create: async () => {
        auditWrites += 1;
        return {};
      },
    },
  };
  const prisma = {
    customer: { findFirst: async () => existing },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      transactionAttempts += 1;
      if (transactionAttempts === 1) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate phone", {
          code: "P2002",
          clientVersion: "6.19.3",
        });
      }
      return callback(tx);
    },
  } as unknown as PrismaService;
  const service = new CustomersService(
    prisma,
    { requireSession: async () => tenancyFixture.clinicAActor } as unknown as AuthService,
  );

  const result = await service.resolveForAppointment({
    organizationId: "clinic-a",
    existingCustomerId: "client-a",
    mode: "use_existing",
    name: "Existing Client",
    phone: "9812345678",
    risk: "Routine",
  });

  assert.equal(result.id, "client-a");
  assert.equal(transactionAttempts, 2);
  assert.equal(auditWrites, 1);
});

test("legacy Client creation rejects a phone without 7 to 15 canonical digits", async () => {
  const { service } = createService();

  await assert.rejects(
    service.create({
      organizationId: "clinic-a",
      name: "Invalid Phone",
      phone: "abc",
      risk: "Routine",
    }),
    /Phone number must contain 7 to 15 digits/,
  );
});

test("legacy prior-visit review keeps exact phone evidence ahead of name fallbacks", async () => {
  let queryCount = 0;
  let reviewSnapshot: unknown;
  const created = {
    id: "client-new",
    organizationId: "clinic-a",
    fullName: "New Household Member",
    patientCode: "CL-000010",
    phone: "9800000000",
    email: null,
    gender: null,
    dateOfBirth: null,
    address: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    allergies: null,
    medicalNotes: null,
    riskLabel: "Routine",
    lastVisitAt: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    dentalChart: null,
  };
  const tx = {
    clientCodeSequence: { upsert: async () => ({ nextValue: 11 }) },
    customer: { create: async () => created },
    clientPhone: { create: async () => ({}) },
    clientIdentityReview: {
      create: async ({ data }: { data: { candidateSnapshot: unknown } }) => {
        reviewSnapshot = data.candidateSnapshot;
        return {};
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const prisma = {
    customer: {
      findMany: async () => {
        queryCount += 1;
        return queryCount === 1
          ? [{
              id: "client-exact",
              fullName: "Different Household Member",
              normalizedPhone: "9779800000000",
              phones: [],
            }]
          : [{
              id: "client-name",
              fullName: "New Household Member",
              normalizedPhone: "9779811111111",
              phones: [],
            }];
      },
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaService;
  const service = new CustomersService(
    prisma,
    { requireSession: async () => tenancyFixture.clinicAActor } as unknown as AuthService,
  );

  await service.resolveForAppointment({
    organizationId: "clinic-a",
    mode: "create_new",
    name: "New Household Member",
    phone: "9800000000",
    risk: "Routine",
    priorVisitedClinic: true,
  });

  const evidence = reviewSnapshot as Array<Record<string, unknown>>;
  assert.equal(evidence[0]?.customerId, "client-exact");
  assert.equal(evidence[0]?.score, 100);
  assert.equal(evidence[0]?.confidence, "possible");
  assert.deepEqual(evidence[0]?.matchedOn, ["phone"]);
});
