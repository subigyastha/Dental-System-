import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ConflictException } from "@nestjs/common";

import { BookingAvailabilityService } from "./booking-availability.service";

const actor = {
  id: "user-a",
  organizationId: "organization-a",
  name: "Reception",
  email: "reception@example.test",
  role: "Receptionist",
  effectiveRoles: ["Receptionist"],
};

const futureSlotStart = new Date();
futureSlotStart.setUTCDate(futureSlotStart.getUTCDate() + 30);
futureSlotStart.setUTCHours(4, 15, 0, 0);
const futureDateKey = futureSlotStart.toISOString().slice(0, 10);

const slot = {
  startsAtIso: futureSlotStart.toISOString(),
  time: "10:00",
  timeLabel: "10:00",
  dateKey: futureDateKey,
};
const draftId = "00000000-0000-4000-8000-000000000001";

function createService(options?: {
  activeHolds?: Array<Record<string, unknown>>;
  replay?: Record<string, unknown> | null;
}) {
  const events: string[] = [];
  const activeHolds = options?.activeHolds ?? [];
  const holdRow = {
    id: "hold-a",
    draftId,
    idempotencyKey: "1234567890abcdef",
    requestHash: "",
    organizationId: "organization-a",
    locationId: "location-a",
    providerId: "provider-a",
    serviceId: "service-a",
    startsAt: new Date(slot.startsAtIso),
    endsAt: new Date(futureSlotStart.getTime() + 30 * 60_000),
    bufferMinutes: 10,
    expiresAt: new Date(Date.now() + 180_000),
    releasedAt: null,
    consumedAt: null,
    createdByUserId: "user-a",
  };
  const tx = {
    $queryRaw: async (query: { strings?: string[] }) => {
      const sql = query.strings?.join("") ?? "";
      if (sql.includes("CURRENT_TIMESTAMP")) return [{ now: new Date() }];
      events.push("provider-lock");
      return [{ id: "provider-a" }];
    },
    bookingSlotHold: {
      findUnique: async () => {
        events.push("idempotency-recheck");
        return options?.replay ?? null;
      },
      findMany: async () => {
        events.push("hold-conflict-check");
        return activeHolds;
      },
      count: async () => 0,
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push("hold-create");
        return { ...holdRow, ...data };
      },
    },
    organizationSetting: {
      findUnique: async () => ({ bookingHoldMinutes: 3 }),
    },
    auditLog: { create: async () => ({}) },
  };
  const prisma = {
    location: {
      findFirst: async () => ({ id: "location-a", timezone: "Asia/Kathmandu" }),
    },
    bookingSlotHold: {
      findUnique: async () => options?.replay ?? null,
      findMany: async () => activeHolds,
    },
    $queryRaw: async () => [{ now: new Date() }],
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const scheduling = {
    listProviderSlots: async () => ({
      providerId: "provider-a",
      dateKey: futureDateKey,
      durationMinutes: 30,
      bufferMinutes: 10,
      slots: [
        slot,
        {
          ...slot,
          startsAtIso: new Date(
            futureSlotStart.getTime() + 15 * 60_000,
          ).toISOString(),
          time: "10:15",
          timeLabel: "10:15",
        },
      ],
    }),
    getServiceTiming: async () => ({
      durationMinutes: 30,
      serviceBufferMinutes: 10,
    }),
    getEffectiveSlotTiming: async () => {
      events.push("appointment-conflict-check");
      return {
        durationMinutes: 30,
        bufferMinutes: 10,
      };
    },
    assertSlotAvailable: async () => {
      events.push("appointment-conflict-check");
    },
  };
  return {
    events,
    service: new BookingAvailabilityService(
      prisma as never,
      { requireSession: async () => actor } as never,
      scheduling as never,
    ),
  };
}

async function createHoldDto(service: BookingAvailabilityService) {
  const availability = await service.rankedAvailability(
    {
      locationId: "location-a",
      providerId: "provider-a",
      serviceId: "service-a",
      date: futureDateKey,
    },
    actor,
  );
  const rankedSlot = availability.recommended[0];
  assert.ok(rankedSlot);
  return {
    draftId,
    locationId: "location-a",
    providerId: "provider-a",
    serviceId: "service-a",
    startsAtIso: rankedSlot.startsAtIso,
    slotId: rankedSlot.slotId,
    availabilityVersion: availability.availabilityVersion,
    idempotencyKey: "1234567890abcdef",
  };
}

test("ranked availability excludes active holds and lets the API own ordering", async () => {
  const heldStart = new Date(slot.startsAtIso);
  const { service } = createService({
    activeHolds: [
      {
        id: "other-hold",
        startsAt: heldStart,
        endsAt: new Date(heldStart.getTime() + 30 * 60_000),
        bufferMinutes: 10,
      },
    ],
  });

  const result = await service.rankedAvailability(
    {
      locationId: "location-a",
      providerId: "provider-a",
      serviceId: "service-a",
      date: futureDateKey,
    },
    actor,
  );

  assert.equal(result.recommended.length, 0);
  assert.equal(result.later.length, 0);
  assert.equal(result.timezone, "Asia/Kathmandu");
});

test("hold creation takes the Provider lock before conflict recheck and create", async () => {
  const { events, service } = createService();
  const dto = await createHoldDto(service);
  const result = await service.createHold(dto, actor);

  assert.equal(result.status, "active");
  assert.ok(events.indexOf("provider-lock") < events.indexOf("hold-conflict-check"));
  assert.ok(events.indexOf("hold-conflict-check") < events.indexOf("hold-create"));
});

test("overlapping active holds fail without creating another hold", async () => {
  const startsAt = new Date(slot.startsAtIso);
  const { events, service } = createService({
    activeHolds: [
      {
        id: "hold-other",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        bufferMinutes: 10,
      },
    ],
  });

  await assert.rejects(
    service.createHold(
      {
        draftId,
        locationId: "location-a",
        providerId: "provider-a",
        serviceId: "service-a",
        startsAtIso: slot.startsAtIso,
        slotId: "00000000000000000000",
        availabilityVersion: "000000000000000000000000",
        idempotencyKey: "1234567890abcdef",
      },
      actor,
    ),
    ConflictException,
  );
  assert.equal(events.includes("hold-create"), false);
});

test("an idempotency replay returns the original hold without a new transaction", async () => {
  const startsAt = new Date(slot.startsAtIso);
  const replay = {
    id: "hold-replay",
    draftId,
    idempotencyKey: "1234567890abcdef",
    organizationId: "organization-a",
    locationId: "location-a",
    providerId: "provider-a",
    serviceId: "service-a",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    bufferMinutes: 10,
    expiresAt: new Date(Date.now() + 60_000),
    releasedAt: null,
    consumedAt: null,
    createdByUserId: "user-a",
  };
  const request = {
    draftId,
    locationId: "location-a",
    providerId: "provider-a",
    serviceId: "service-a",
    startsAtIso: slot.startsAtIso,
    slotId: "00000000000000000000",
    availabilityVersion: "000000000000000000000000",
    idempotencyKey: "1234567890abcdef",
  };
  Object.assign(replay, {
    requestHash: createHash("sha256")
      .update(
        JSON.stringify({
          draftId: request.draftId,
          locationId: request.locationId,
          providerId: request.providerId,
          serviceId: request.serviceId,
          startsAtIso: new Date(request.startsAtIso).toISOString(),
          slotId: request.slotId,
          availabilityVersion: request.availabilityVersion,
        }),
      )
      .digest("hex"),
  });
  const { events, service } = createService({ replay });

  const result = await service.createHold(request, actor);

  assert.equal(result.id, "hold-replay");
  assert.deepEqual(events, []);
});

test("an idempotency key cannot be reused for a different hold request", async () => {
  const startsAt = new Date(slot.startsAtIso);
  const replay = {
    id: "hold-replay",
    draftId,
    idempotencyKey: "1234567890abcdef",
    requestHash: "different-request",
    organizationId: "organization-a",
    locationId: "location-a",
    providerId: "provider-a",
    serviceId: "service-a",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    bufferMinutes: 10,
    expiresAt: new Date(Date.now() + 60_000),
    releasedAt: null,
    consumedAt: null,
    createdByUserId: "user-a",
  };
  const { service } = createService({ replay });

  await assert.rejects(
    service.createHold(
      {
        draftId,
        locationId: "location-a",
        providerId: "provider-a",
        serviceId: "service-a",
        startsAtIso: slot.startsAtIso,
        slotId: "00000000000000000000",
        availabilityVersion: "000000000000000000000000",
        idempotencyKey: "1234567890abcdef",
      },
      actor,
    ),
    (error: unknown) =>
      error instanceof ConflictException &&
      error.getResponse() instanceof Object &&
      (error.getResponse() as { code?: string }).code ===
        "IDEMPOTENCY_KEY_REUSED",
  );
});

test("hold creation rejects a stale availability version", async () => {
  const { events, service } = createService();

  await assert.rejects(
    service.createHold(
      {
        draftId,
        locationId: "location-a",
        providerId: "provider-a",
        serviceId: "service-a",
        startsAtIso: slot.startsAtIso,
        slotId: "00000000000000000000",
        availabilityVersion: "000000000000000000000000",
        idempotencyKey: "1234567890abcdef",
      },
      actor,
    ),
    (error: unknown) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code ===
        "AVAILABILITY_CHANGED",
  );
  assert.equal(events.includes("hold-create"), false);
});

test("hold release serializes on Provider and hold rows before transitioning", async () => {
  const events: string[] = [];
  const hold = {
    id: "hold-a",
    draftId,
    idempotencyKey: "1234567890abcdef",
    requestHash: "request",
    organizationId: "organization-a",
    locationId: "location-a",
    providerId: "provider-a",
    serviceId: "service-a",
    startsAt: new Date(slot.startsAtIso),
    endsAt: new Date(futureSlotStart.getTime() + 30 * 60_000),
    bufferMinutes: 10,
    expiresAt: new Date(Date.now() + 60_000),
    releasedAt: null,
    consumedAt: null,
    createdByUserId: "user-a",
  };
  const tx = {
    bookingSlotHold: {
      findFirst: async () => hold,
      update: async () => {
        events.push("release-update");
        return hold;
      },
    },
    auditLog: { create: async () => ({}) },
    $queryRaw: async (query: { strings?: string[] }) => {
      const sql = query.strings?.join("") ?? "";
      if (sql.includes('FROM "Provider"')) {
        events.push("provider-lock");
        return [{ id: "provider-a" }];
      }
      if (sql.includes('FROM "BookingSlotHold"')) {
        events.push("hold-lock");
        return [{ releasedAt: null, consumedAt: null }];
      }
      return [{ now: new Date() }];
    },
  };
  const service = new BookingAvailabilityService(
    {
      $transaction: async (
        operation: (transaction: typeof tx) => Promise<unknown>,
      ) => operation(tx),
    } as never,
    { requireSession: async () => actor } as never,
    {} as never,
  );

  assert.deepEqual(await service.releaseHold("hold-a", actor), {
    id: "hold-a",
    released: true,
  });
  assert.ok(events.indexOf("provider-lock") < events.indexOf("hold-lock"));
  assert.ok(events.indexOf("hold-lock") < events.indexOf("release-update"));
});
