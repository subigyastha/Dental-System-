import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { HttpException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { BookingConfirmationService } from "../modules/api-v1/booking-confirmation.service";

const databaseUrl = process.env.BOOKING_CONFIRMATION_TEST_DATABASE_URL;

test(
  "atomic booking confirmation uses real PostgreSQL locks and rollback",
  { skip: databaseUrl ? false : "Set BOOKING_CONFIRMATION_TEST_DATABASE_URL to run" },
  async () => {
    process.env.DATABASE_URL = databaseUrl;
    const prisma = new PrismaClient();
    const prefix = `b6-${randomUUID()}`;
    const organizationId = `${prefix}-organization`;
    const locationId = `${prefix}-location`;
    const actorUserId = `${prefix}-actor`;
    const providerId = `${prefix}-provider`;
    const serviceId = `${prefix}-service`;
    const customerId = `${prefix}-customer`;
    const actor = {
      id: actorUserId,
      organizationId,
      role: "Receptionist",
      effectiveRoles: ["Receptionist"],
      name: "B6 Reception",
      email: `${prefix}@example.test`,
    };
    const scheduling = {
      getEffectiveSlotTiming: async () => ({
        durationMinutes: 30,
        bufferMinutes: 10,
      }),
      invalidateAppointmentPlanning: () => undefined,
    };
    const auth = { requireSession: async () => actor };
    const service = new BookingConfirmationService(
      prisma as never,
      auth as never,
      scheduling as never,
    );
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 30);
    future.setUTCMinutes(0, 0, 0);

    try {
      await prisma.organization.create({
        data: { id: organizationId, name: "B6 integration clinic" },
      });
      await prisma.location.create({
        data: {
          id: locationId,
          organizationId,
          name: "B6 integration location",
        },
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
      await prisma.provider.create({
        data: {
          id: providerId,
          organizationId,
          displayName: "B6 Provider",
          roleLabel: "Dentist",
        },
      });
      await prisma.service.create({
        data: {
          id: serviceId,
          organizationId,
          name: "B6 Service",
          category: "General",
          durationMinutes: 30,
          bufferMinutes: 10,
        },
      });
      await prisma.customer.create({
        data: {
          id: customerId,
          organizationId,
          fullName: "Existing B6 Client",
          phone: "9800000000",
          normalizedPhone: "9779800000000",
        },
      });

      const existingClient = { mode: "existing" as const, clientId: customerId };
      const dtoAt = (startsAt: Date) => ({
        draftId: randomUUID(),
        locationId,
        providerId,
        serviceId,
        startsAtIso: startsAt.toISOString(),
        priority: "Normal" as const,
        client: existingClient,
      });

      const sameKeyDto = dtoAt(future);
      const [sameKeyA, sameKeyB] = await Promise.all([
        service.confirm(sameKeyDto, `${prefix}-same-key-0001`, actor),
        service.confirm(sameKeyDto, `${prefix}-same-key-0001`, actor),
      ]);
      assert.equal(
        sameKeyA.appointment.id,
        sameKeyB.appointment.id,
        "concurrent replay must return the one committed appointment",
      );
      assert.equal(
        await prisma.bookingConfirmation.count({
          where: {
            organizationId,
            actorUserId,
            idempotencyKey: `${prefix}-same-key-0001`,
          },
        }),
        1,
      );

      const contestedStart = new Date(future.getTime() + 2 * 60 * 60_000);
      const contested = await Promise.allSettled([
        service.confirm(
          dtoAt(contestedStart),
          `${prefix}-same-slot-0001`,
          actor,
        ),
        service.confirm(
          dtoAt(contestedStart),
          `${prefix}-same-slot-0002`,
          actor,
        ),
      ]);
      assert.equal(
        contested.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const rejectedSlot = contested.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      assert.equal(domainReason(rejectedSlot?.reason), "SLOT_UNAVAILABLE");
      assert.equal(
        await prisma.appointment.count({
          where: { organizationId, startsAt: contestedStart },
        }),
        1,
      );

      const identityStart = new Date(future.getTime() + 4 * 60 * 60_000);
      const normalizedNewPhone = "9779800000011";
      const emptyCandidateVersion = createHash("sha256")
        .update(`np-v1:${normalizedNewPhone}:`)
        .digest("hex")
        .slice(0, 24);
      const newClientDto = (startsAt: Date) => ({
        ...dtoAt(startsAt),
        client: {
          mode: "new" as const,
          name: "Concurrent B6 Client",
          phone: "9800000011",
          priorVisitedClinic: false,
          duplicateCheckAcknowledged: true,
          skippedPossibleMatchClientIds: [],
          candidateSetVersion: emptyCandidateVersion,
        },
      });
      const identityResults = await Promise.allSettled([
        service.confirm(
          newClientDto(identityStart),
          `${prefix}-identity-0001`,
          actor,
        ),
        service.confirm(
          newClientDto(new Date(identityStart.getTime() + 60 * 60_000)),
          `${prefix}-identity-0002`,
          actor,
        ),
      ]);
      assert.equal(
        identityResults.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const rejectedIdentity = identityResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      assert.equal(
        domainReason(rejectedIdentity?.reason),
        "IDENTITY_MATCH_CHANGED",
      );
      assert.equal(
        await prisma.customer.count({
          where: { organizationId, normalizedPhone: normalizedNewPhone },
        }),
        1,
      );

      const expiredStart = new Date(future.getTime() + 7 * 60 * 60_000);
      const expiredDraftId = randomUUID();
      const expiredCreatedAt = new Date(Date.now() - 2 * 60_000);
      const expiredHold = await prisma.bookingSlotHold.create({
        data: {
          draftId: expiredDraftId,
          idempotencyKey: `${prefix}-expired-hold`,
          requestHash: "integration-expired-hold",
          organizationId,
          locationId,
          providerId,
          serviceId,
          startsAt: expiredStart,
          endsAt: new Date(expiredStart.getTime() + 30 * 60_000),
          bufferMinutes: 10,
          expiresAt: new Date(Date.now() - 60_000),
          createdByUserId: actorUserId,
          createdAt: expiredCreatedAt,
        },
      });
      await assert.rejects(
        service.confirm(
          {
            ...dtoAt(expiredStart),
            draftId: expiredDraftId,
            holdId: expiredHold.id,
          },
          `${prefix}-expired-confirm`,
          actor,
        ),
        (error) => domainReason(error) === "HOLD_EXPIRED",
      );
      assert.equal(
        await prisma.appointment.count({
          where: { organizationId, startsAt: expiredStart },
        }),
        0,
      );

      const rollbackPhone = "9779800000022";
      const rollbackVersion = createHash("sha256")
        .update(`np-v1:${rollbackPhone}:`)
        .digest("hex")
        .slice(0, 24);
      const failingPrisma = receiptFailingPrisma(prisma);
      const failingService = new BookingConfirmationService(
        failingPrisma as never,
        auth as never,
        scheduling as never,
      );
      const rollbackStart = new Date(future.getTime() + 9 * 60 * 60_000);
      await assert.rejects(
        failingService.confirm(
          {
            ...dtoAt(rollbackStart),
            client: {
              mode: "new",
              name: "Rolled Back B6 Client",
              phone: "9800000022",
              priorVisitedClinic: false,
              duplicateCheckAcknowledged: true,
              skippedPossibleMatchClientIds: [],
              candidateSetVersion: rollbackVersion,
            },
          },
          `${prefix}-rollback-0001`,
          actor,
        ),
        /forced receipt failure/,
      );
      assert.equal(
        await prisma.customer.count({
          where: { organizationId, normalizedPhone: rollbackPhone },
        }),
        0,
      );
      assert.equal(
        await prisma.appointment.count({
          where: { organizationId, startsAt: rollbackStart },
        }),
        0,
      );
    } finally {
      await prisma.bookingConfirmation.deleteMany({ where: { organizationId } });
      await prisma.bookingSlotHold.deleteMany({ where: { organizationId } });
      await prisma.appointment.deleteMany({ where: { organizationId } });
      await prisma.customer.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.$disconnect();
    }
  },
);

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
    bookingConfirmation: prisma.bookingConfirmation,
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
              if (property !== "bookingConfirmation") {
                return Reflect.get(target, property, receiver);
              }
              return new Proxy(target.bookingConfirmation, {
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
