import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";

import { BookingConfirmationService } from "./booking-confirmation.service";

const startsAtIso = "2030-01-01T03:15:00.000Z";
const dto = {
  draftId: "00000000-0000-4000-8000-000000000001",
  locationId: "location-a",
  providerId: "provider-a",
  serviceId: "service-a",
  startsAtIso,
  priority: "Normal" as const,
  notes: "Review",
  client: { mode: "existing" as const, clientId: "client-a" },
};
const actor = {
  id: "user-a",
  organizationId: "organization-a",
  role: "Receptionist",
  effectiveRoles: ["Receptionist"],
  name: "Reception",
  email: "reception@example.test",
};

function fixture(options?: {
  replay?: { requestHash: string; response: Record<string, unknown> } | null;
  hold?: Record<string, unknown>;
  session?: typeof actor & { providerId?: string };
}) {
  const events: string[] = [];
  const now = new Date("2029-12-01T00:00:00.000Z");
  const tx = {
    $executeRaw: async () => {
      events.push("idempotency-lock");
      return 1;
    },
    $queryRaw: async (query: { strings?: string[] }) => {
      const sql = query.strings?.join("") ?? "";
      if (sql.includes('FROM "Provider"')) {
        events.push("provider-lock");
        return [{ id: "provider-a" }];
      }
      if (sql.includes('FROM "BookingSlotHold"')) {
        events.push("hold-lock");
        return options?.hold ? [options.hold] : [];
      }
      return [{ now }];
    },
    bookingConfirmation: {
      findUnique: async () => null,
      create: async () => {
        events.push("receipt-create");
        return {};
      },
    },
    location: {
      findFirst: async () => ({ id: "location-a" }),
    },
    bookingSlotHold: {
      findMany: async () => [],
      updateMany: async () => {
        events.push("hold-consume");
        return { count: 1 };
      },
    },
    customer: {
      findFirst: async () => ({
        id: "client-a",
        fullName: "Asha Rai",
        patientCode: "CL-000001",
        phone: "9800000000",
        phones: [{ normalizedValue: "9779800000000" }],
      }),
      findMany: async () => [],
      create: async () => ({
        id: "client-new",
        fullName: "Nima Sherpa",
        patientCode: "CL-000002",
      }),
    },
    clientCodeSequence: {
      upsert: async () => ({ nextValue: 3 }),
    },
    clientPhone: { create: async () => ({ id: "phone-new" }) },
    clientIdentityReview: {
      create: async () => ({ id: "review-new" }),
    },
    appointment: {
      create: async () => {
        events.push("appointment-create");
        return { id: "appointment-a" };
      },
    },
    workflowEvent: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
  };
  const prisma = {
    bookingConfirmation: {
      findUnique: async () => options?.replay ?? null,
    },
    $transaction: async (
      operation: (transaction: typeof tx) => Promise<unknown>,
    ) => operation(tx),
  };
  const scheduling = {
    getEffectiveSlotTiming: async () => {
      events.push("schedule-recheck");
      return {
      durationMinutes: 30,
      bufferMinutes: 10,
      };
    },
    invalidateAppointmentPlanning: () => {
      events.push("cache-invalidate");
    },
  };
  return {
    events,
    service: new BookingConfirmationService(
      prisma as never,
      { requireSession: async () => options?.session ?? actor } as never,
      scheduling as never,
    ),
  };
}

test("confirmation creates appointment and receipt in one transaction", async () => {
  const { events, service } = fixture();
  const result = await service.confirm(
    dto,
    "1234567890abcdef",
    actor,
  );

  assert.equal(result.appointment.id, "appointment-a");
  assert.equal(result.client.id, "client-a");
  assert.equal(result.replayed, false);
  assert.ok(
    events.indexOf("idempotency-lock") <
      events.indexOf("provider-lock"),
  );
  assert.ok(
    events.indexOf("schedule-recheck") <
      events.indexOf("appointment-create"),
  );
  assert.ok(
    events.indexOf("appointment-create") <
      events.indexOf("receipt-create"),
  );
  assert.ok(
    events.indexOf("receipt-create") <
      events.indexOf("cache-invalidate"),
  );
});

test("completed confirmation replay returns the stored result without a transaction", async () => {
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        draftId: dto.draftId,
        locationId: dto.locationId,
        providerId: dto.providerId,
        serviceId: dto.serviceId,
        startsAtIso: new Date(dto.startsAtIso).toISOString(),
        priority: dto.priority,
        notes: dto.notes,
        client: {
          mode: "existing",
          clientId: dto.client.clientId,
        },
      }),
    )
    .digest("hex");
  const { events, service } = fixture({
    replay: {
      requestHash,
      response: {
        confirmationId: "confirmation-a",
        appointment: { id: "appointment-a" },
        client: { id: "client-a" },
        hold: null,
        replayed: false,
      },
    },
  });

  const result = await service.confirm(
    dto,
    "1234567890abcdef",
    actor,
  );
  assert.equal(result.replayed, true);
  assert.equal(result.confirmationId, "confirmation-a");
  assert.deepEqual(events, []);
});

test("reusing a confirmation key for changed content is rejected", async () => {
  const { service } = fixture({
    replay: {
      requestHash: "different",
      response: {},
    },
  });
  await assert.rejects(
    service.confirm(dto, "1234567890abcdef", actor),
    (error: unknown) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code ===
        "IDEMPOTENCY_KEY_REUSED",
  );
});

test("slot-first confirmation locks and consumes its exact hold", async () => {
  const startsAt = new Date(startsAtIso);
  const { events, service } = fixture({
    hold: {
      id: "hold-a",
      draftId: dto.draftId,
      organizationId: actor.organizationId,
      createdByUserId: actor.id,
      locationId: dto.locationId,
      providerId: dto.providerId,
      serviceId: dto.serviceId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      bufferMinutes: 10,
      expiresAt: new Date("2029-12-01T00:03:00.000Z"),
      releasedAt: null,
      consumedAt: null,
    },
  });
  const result = await service.confirm(
    { ...dto, holdId: "hold-a" },
    "1234567890abcdef",
    actor,
  );

  assert.equal(result.hold?.status, "consumed");
  assert.ok(events.indexOf("provider-lock") < events.indexOf("hold-lock"));
  assert.ok(
    events.indexOf("appointment-create") <
      events.indexOf("hold-consume"),
  );
  assert.ok(
    events.indexOf("hold-consume") <
      events.indexOf("receipt-create"),
  );
});

test("Provider actors cannot confirm another Provider's booking", async () => {
  const providerActor = {
    ...actor,
    role: "Provider",
    effectiveRoles: ["Provider"],
    providerId: "provider-own",
  };
  const { service } = fixture({ session: providerActor });
  await assert.rejects(
    service.confirm(dto, "1234567890abcdef", providerActor),
    ForbiddenException,
  );
});

test("Receptionist can create a Client and appointment atomically", async () => {
  const { service } = fixture();
  const result = await service.confirm(
    {
      ...dto,
      client: {
        mode: "new",
        name: "Nima Sherpa",
        phone: "9800000001",
        priorVisitedClinic: true,
        duplicateCheckAcknowledged: true,
        skippedPossibleMatchClientIds: [],
        candidateSetVersion: "d425f6e64e5e6a21d8be1d5c",
      },
    },
    "1234567890abcdef",
    actor,
  );

  assert.equal(result.client.id, "client-new");
  assert.equal(result.client.created, true);
  assert.equal(result.client.identityReviewCreated, true);
  assert.equal(result.appointment.id, "appointment-a");
});

test("Provider can create a new Client while booking their own appointment", async () => {
  const providerActor = {
    ...actor,
    role: "Provider",
    effectiveRoles: ["Provider"],
    providerId: "provider-a",
  };
  const { service } = fixture({ session: providerActor });
  const result = await service.confirm(
    {
      ...dto,
      client: {
        mode: "new",
        name: "Nima Sherpa",
        phone: "9800000001",
        priorVisitedClinic: false,
        duplicateCheckAcknowledged: true,
        skippedPossibleMatchClientIds: [],
        candidateSetVersion: "d425f6e64e5e6a21d8be1d5c",
      },
    },
    "1234567890abcdef",
    providerActor,
  );
  assert.equal(result.client.id, "client-new");
  assert.equal(result.client.created, true);
  assert.equal(result.appointment.id, "appointment-a");
});

test("Provider can append a new caller phone to an existing Client while booking", async () => {
  const providerActor = {
    ...actor,
    role: "Provider",
    effectiveRoles: ["Provider"],
    providerId: "provider-a",
  };
  const { service } = fixture({ session: providerActor });
  const result = await service.confirm(
    {
      ...dto,
      client: {
        mode: "existing",
        clientId: "client-a",
        phone: "9800000099",
      },
    },
    "1234567890abcdef",
    providerActor,
  );

  assert.equal(result.client.created, false);
  assert.equal(result.client.phoneAppended, true);
  assert.equal(result.appointment.id, "appointment-a");
});

test("new Client confirmation requires a reviewed candidate-set version", async () => {
  const { service } = fixture();
  await assert.rejects(
    service.confirm(
      {
        ...dto,
        client: {
          mode: "new",
          name: "Nima Sherpa",
          phone: "9800000001",
          priorVisitedClinic: false,
          duplicateCheckAcknowledged: true,
          skippedPossibleMatchClientIds: [],
        },
      },
      "1234567890abcdef",
      actor,
    ),
    BadRequestException,
  );
});
