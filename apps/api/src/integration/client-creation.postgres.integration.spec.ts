import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { HttpException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { ClientsV1Service } from "../modules/api-v1/clients-v1.service";
import { buildClientCandidateSetVersion } from "../modules/customers/client-match-version";
import { normalizeClientPhone } from "../modules/customers/client-phone-normalization";

const databaseUrl = process.env.CLIENT_CREATION_TEST_DATABASE_URL;

test(
  "standalone Client creation is idempotent and rolls back without its receipt",
  { skip: databaseUrl ? false : "Set CLIENT_CREATION_TEST_DATABASE_URL to run" },
  async () => {
    process.env.DATABASE_URL = databaseUrl;
    const prisma = new PrismaClient();
    const prefix = `b7-${randomUUID()}`;
    const organizationId = `${prefix}-organization`;
    const actorUserId = `${prefix}-actor`;
    const actor = {
      id: actorUserId,
      organizationId,
      role: "Receptionist",
      effectiveRoles: ["Receptionist"],
      name: "B7 Reception",
      email: `${prefix}@example.test`,
    };
    const auth = { requireSession: async () => actor };
    const service = new ClientsV1Service(prisma as never, auth as never);
    const phone = "9800000044";
    const dto = {
      name: "Concurrent B7 Client",
      phone,
      risk: "Routine" as const,
      candidateSetVersion: emptyCandidateVersion(phone),
    };

    try {
      await prisma.organization.create({
        data: { id: organizationId, name: "B7 integration clinic" },
      });
      await prisma.user.create({
        data: {
          id: actorUserId,
          organizationId,
          name: actor.name,
          email: actor.email,
          role: "Receptionist",
        },
      });

      const [first, second] = await Promise.all([
        service.create(dto, `${prefix}-same-key-0001`, actor),
        service.create(dto, `${prefix}-same-key-0001`, actor),
      ]);
      assert.equal(first.id, second.id);
      assert.equal(
        await prisma.customer.count({
          where: {
            organizationId,
            normalizedPhone: normalizeClientPhone(phone),
          },
        }),
        1,
      );
      assert.equal(
        await prisma.clientCreationReceipt.count({
          where: {
            organizationId,
            actorUserId,
            idempotencyKey: `${prefix}-same-key-0001`,
          },
        }),
        1,
      );

      const contestedPhone = "9800000066";
      const contestedDto = {
        ...dto,
        name: "Contested B7 Client",
        phone: contestedPhone,
        candidateSetVersion: emptyCandidateVersion(contestedPhone),
      };
      const contested = await Promise.allSettled([
        service.create(contestedDto, `${prefix}-identity-0001`, actor),
        service.create(contestedDto, `${prefix}-identity-0002`, actor),
      ]);
      assert.equal(
        contested.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const rejectedIdentity = contested.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      assert.equal(domainReason(rejectedIdentity?.reason), "IDENTITY_MATCH_CHANGED");
      assert.equal(
        await prisma.customer.count({
          where: {
            organizationId,
            normalizedPhone: normalizeClientPhone(contestedPhone),
          },
        }),
        1,
      );

      const rollbackPhone = "9800000055";
      const failingService = new ClientsV1Service(
        receiptFailingPrisma(prisma) as never,
        auth as never,
      );
      await assert.rejects(
        failingService.create(
          {
            ...dto,
            name: "Rolled Back B7 Client",
            phone: rollbackPhone,
            candidateSetVersion: emptyCandidateVersion(rollbackPhone),
          },
          `${prefix}-rollback-0001`,
          actor,
        ),
        /forced receipt failure/,
      );
      assert.equal(
        await prisma.customer.count({
          where: {
            organizationId,
            normalizedPhone: normalizeClientPhone(rollbackPhone),
          },
        }),
        0,
      );
    } finally {
      await prisma.clientCreationReceipt.deleteMany({
        where: { organizationId },
      });
      await prisma.clientIdentityReview.deleteMany({
        where: { organizationId },
      });
      await prisma.clientPhone.deleteMany({ where: { organizationId } });
      await prisma.patientDentalChart.deleteMany({
        where: { customer: { organizationId } },
      });
      await prisma.customer.deleteMany({ where: { organizationId } });
      await prisma.user.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.$disconnect();
    }
  },
);

function emptyCandidateVersion(phone: string) {
  return buildClientCandidateSetVersion(normalizeClientPhone(phone), []);
}

function domainReason(error: unknown) {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  if (!response || typeof response !== "object" || !("code" in response)) {
    return undefined;
  }
  return typeof response.code === "string" ? response.code : undefined;
}

function receiptFailingPrisma(prisma: PrismaClient) {
  return {
    clientCreationReceipt: prisma.clientCreationReceipt,
    $transaction: (
      operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: {
        isolationLevel: Prisma.TransactionIsolationLevel;
        maxWait?: number;
        timeout?: number;
      },
    ) =>
      prisma.$transaction(
        (tx) => {
          const wrapped = new Proxy(tx, {
            get(target, property, receiver) {
              if (property !== "clientCreationReceipt") {
                return Reflect.get(target, property, receiver);
              }
              return new Proxy(target.clientCreationReceipt, {
                get(delegate, delegateProperty, delegateReceiver) {
                  if (delegateProperty === "create") {
                    return async () => {
                      throw new Error("forced receipt failure");
                    };
                  }
                  return Reflect.get(
                    delegate,
                    delegateProperty,
                    delegateReceiver,
                  );
                },
              });
            },
          });
          return operation(wrapped as Prisma.TransactionClient);
        },
        options,
      ),
  };
}
