import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "@nestjs/common";

import { ScheduleCacheService } from "./schedule-cache.service";
import { SchedulingService } from "./scheduling.service";

function createSchedulingService(
  slotStartIntervalMinutes = 15,
  onConfigurationRead: () => void = () => undefined,
  onPrisma: (prisma: Record<string, unknown>) => void = () => undefined,
) {
  const prisma = {
    organizationSetting: {
      findUnique: async () => {
        onConfigurationRead();
        return {
          businessDayStartsAt: "08:00",
          businessDayEndsAt: "18:00",
          slotStartIntervalMinutes,
          scheduleConfigurationVersion: 1,
        };
      },
    },
    provider: {
      findMany: async () => [
        {
          id: "provider-a",
          status: "Available",
          user: { status: "Active" },
        },
      ],
    },
    providerAvailability: {
      findMany: async () => [
        {
          id: "availability-a",
          providerId: "provider-a",
          startsAtLocal: "09:00",
          endsAtLocal: "10:00",
          slotDurationMinutes: 15,
          bufferMinutes: 0,
        },
      ],
    },
    providerRecurringBlock: {
      findMany: async () => [],
    },
    blockedTime: {
      findMany: async () => [],
    },
    appointment: {
      findMany: async () => [
        {
          id: "appointment-a",
          providerId: "provider-a",
          resourceId: null,
          startsAt: new Date("2030-01-01T09:30:00+05:45"),
          durationMinutes: 15,
          bufferMinutes: 0,
        },
      ],
    },
    $transaction: async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
  };

  onPrisma(prisma);
  return new SchedulingService(
    prisma as never,
    new ScheduleCacheService(),
  );
}

test("locked slot reads bypass cached slots and use only the transaction connection", async () => {
  let outsideDb: Record<string, unknown> = {};
  const service = createSchedulingService(15, () => undefined, (db) => { outsideDb = db; });
  const params = { organizationId: "clinic-a", providerId: "provider-a", locationId: "location-a", dateKey: "2030-01-01", durationMinutes: 15 };
  const cached = await service.listProviderSlots(params);
  assert.deepEqual(cached.slots.map((slot) => slot.time), ["09:00", "09:15", "09:45"]);
  const tx = Object.fromEntries(Object.entries(outsideDb).map(([key, model]) => [key, typeof model === "object" ? { ...model } : model]));
  const reads: string[] = [];
  for (const [key, model] of Object.entries(tx)) {
    if (!model || typeof model !== "object") continue;
    for (const [method, operation] of Object.entries(model)) {
      if (typeof operation !== "function") continue;
      (model as Record<string, unknown>)[method] = async (...args: unknown[]) => {
        reads.push(key);
        return operation(...args);
      };
      (outsideDb[key] as Record<string, unknown>)[method] = () => { throw new Error("A second pooled connection was used"); };
    }
  }
  tx.appointment = { findMany: async () => {
    reads.push("appointment");
    return [{ id: "new-appointment", providerId: "provider-a", resourceId: null, startsAt: new Date("2030-01-01T09:00:00+05:45"), durationMinutes: 15, bufferMinutes: 0 }];
  } };
  const fresh = await service.listProviderSlots(params, tx as never);
  assert.deepEqual(fresh.slots.map((slot) => slot.time), ["09:15", "09:30", "09:45"]);
  assert.ok(reads.includes("organizationSetting"));
  assert.ok(reads.includes("provider"));
  assert.ok(reads.includes("appointment"));
  // Transaction-local uncommitted state must not replace the shared read cache.
  assert.deepEqual((await service.listProviderSlots(params)).slots, cached.slots);
});

test("provider slot service rejects an impossible AD date before querying", async () => {
  const service = createSchedulingService();

  await assert.rejects(
    service.listProviderSlots({
      organizationId: "clinic-a",
      providerId: "provider-a",
      locationId: "location-a",
      dateKey: "2030-02-30",
      durationMinutes: 30,
    }),
    (error) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(error.message, /real Gregorian AD date/);
      return true;
    },
  );
});

test("custom duration controls slot end boundaries and conflict filtering", async () => {
  const service = createSchedulingService();
  const common = {
    organizationId: "clinic-a",
    providerId: "provider-a",
    locationId: "location-a",
    dateKey: "2030-01-01",
  };

  const fifteenMinutes = await service.listProviderSlots({
    ...common,
    durationMinutes: 15,
  });
  const thirtyMinutes = await service.listProviderSlots({
    ...common,
    durationMinutes: 30,
  });

  assert.equal(fifteenMinutes.durationMinutes, 15);
  assert.deepEqual(
    fifteenMinutes.slots.map((slot) => slot.time),
    ["09:00", "09:15", "09:45"],
  );

  assert.equal(thirtyMinutes.durationMinutes, 30);
  assert.deepEqual(
    thirtyMinutes.slots.map((slot) => slot.time),
    ["09:00"],
  );
});

test("provider slot cache keeps different requested durations isolated", async () => {
  const service = createSchedulingService();
  const common = {
    organizationId: "clinic-a",
    providerId: "provider-a",
    locationId: "location-a",
    dateKey: "2030-01-01",
  };

  const short = await service.listProviderSlots({
    ...common,
    durationMinutes: 15,
  });
  const long = await service.listProviderSlots({
    ...common,
    durationMinutes: 45,
  });

  assert.equal(short.durationMinutes, 15);
  assert.equal(long.durationMinutes, 45);
  assert.notDeepEqual(short.slots, long.slots);
});

test("schedule configuration is reused before another remote settings read", async () => {
  let configurationReads = 0;
  const service = createSchedulingService(15, () => {
    configurationReads += 1;
  });
  const common = {
    organizationId: "clinic-a",
    providerId: "provider-a",
    locationId: "location-a",
    dateKey: "2030-01-01",
  };

  await service.listProviderSlots({ ...common, durationMinutes: 15 });
  await service.listProviderSlots({ ...common, durationMinutes: 30 });

  assert.equal(configurationReads, 1);
});

test("organization slot interval controls offered starts without changing duration", async () => {
  const service = createSchedulingService(30);
  const result = await service.listProviderSlots({
    organizationId: "clinic-a",
    providerId: "provider-a",
    locationId: "location-a",
    dateKey: "2030-01-01",
    durationMinutes: 15,
  });

  assert.equal(result.durationMinutes, 15);
  assert.deepEqual(result.slots.map((slot) => slot.time), ["09:00"]);
});

test("organization schedule invalidation clears all-provider grids and slot caches", () => {
  const cache = new ScheduleCacheService();
  cache.set("schedule:grid:clinic-a:2030-01-01:providers:all:location:none:config=1", {});
  cache.set("schedule:configuration:clinic-a", {});
  cache.set("schedule:slots:clinic-a:provider-a:2030-01-01:duration=15:location=none:exclude=none:config=1", {});
  cache.set("schedule:grid:clinic-b:2030-01-01:providers:all:location:none:config=1", {});
  const service = new SchedulingService({} as never, cache);

  service.invalidateOrganizationSchedulePlanning("clinic-a");

  assert.deepEqual(cache.keys(), [
    "schedule:grid:clinic-b:2030-01-01:providers:all:location:none:config=1",
  ]);
});

test("service timing matches the location-specific booking catalog", async () => {
  const service = new SchedulingService(
    {
      service: {
        findMany: async () => [
          {
            id: "service-a",
            durationMinutes: 30,
            bufferMinutes: 5,
          },
        ],
      },
      providerService: {
        findMany: async () => [
          {
            serviceId: "service-a",
            locationId: null,
            customDurationMinutes: 40,
          },
          {
            serviceId: "service-a",
            locationId: "location-a",
            customDurationMinutes: 50,
          },
          {
            serviceId: "service-b",
            locationId: "location-a",
            customDurationMinutes: null,
          },
        ],
      },
    } as never,
    new ScheduleCacheService(),
  );

  assert.deepEqual(
    await service.getServiceTiming({
      organizationId: "clinic-a",
      providerId: "provider-a",
      locationId: "location-a",
      serviceIds: ["service-a"],
    }),
    {
      durationMinutes: 50,
      serviceBufferMinutes: 5,
    },
  );
});

test("a provider with an explicit location catalog rejects unsupported services", async () => {
  const service = new SchedulingService(
    {
      service: {
        findMany: async () => [
          {
            id: "service-a",
            durationMinutes: 30,
            bufferMinutes: 5,
          },
        ],
      },
      providerService: {
        findMany: async () => [
          {
            serviceId: "service-b",
            locationId: "location-a",
            customDurationMinutes: null,
          },
        ],
      },
    } as never,
    new ScheduleCacheService(),
  );

  await assert.rejects(
    service.getServiceTiming({
      organizationId: "clinic-a",
      providerId: "provider-a",
      locationId: "location-a",
      serviceIds: ["service-a"],
    }),
    /not configured to perform/,
  );
});

test("effective slot timing preserves the Provider window buffer", async () => {
  const prisma = {
    organizationSetting: {
      findUnique: async () => ({
        businessDayStartsAt: "08:00",
        businessDayEndsAt: "18:00",
        slotStartIntervalMinutes: 15,
        scheduleConfigurationVersion: 1,
      }),
    },
    service: {
      findMany: async () => [
        { id: "service-a", durationMinutes: 30, bufferMinutes: 5 },
      ],
    },
    providerService: { findMany: async () => [] },
    provider: {
      findMany: async () => [
        {
          id: "provider-a",
          status: "Available",
          user: { status: "Active" },
        },
      ],
    },
    providerAvailability: {
      findMany: async () => [
        {
          id: "availability-a",
          providerId: "provider-a",
          startsAtLocal: "09:00",
          endsAtLocal: "10:00",
          slotDurationMinutes: 15,
          bufferMinutes: 20,
        },
      ],
    },
    providerRecurringBlock: { findMany: async () => [] },
    blockedTime: { findMany: async () => [] },
    appointment: { findMany: async () => [] },
    $transaction: async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
  };
  const service = new SchedulingService(
    prisma as never,
    new ScheduleCacheService(),
  );

  assert.deepEqual(
    await service.getEffectiveSlotTiming({
      organizationId: "clinic-a",
      providerId: "provider-a",
      locationId: "location-a",
      serviceId: "service-a",
      startsAtIso: "2030-01-01T03:15:00.000Z",
    }),
    { durationMinutes: 30, bufferMinutes: 20 },
  );
});

for (const bufferMinutes of [0, 15]) {
  test(`day grid occupies the full appointment and ${bufferMinutes}-minute buffer, with an open end boundary`, async () => {
    const service = createSchedulingService(15, () => undefined, (db) => {
      db.appointment = { findMany: async ({ where }: { where: { status: { in: string[] } } }) => {
        assert.deepEqual(where.status.in, ["Scheduled", "Confirmed", "CheckedIn", "InProgress", "Cancelled"]);
        return [{
          id: "appointment-a", providerId: "provider-a",
          startsAt: new Date("2030-01-01T09:00:00+05:45"),
          endsAt: new Date("2030-01-01T09:30:00+05:45"),
          durationMinutes: 30, bufferMinutes, status: "Confirmed",
          customer: { fullName: "Test Client" }, services: [],
        }];
      } };
    });
    const grid = await service.listScheduleGridForDay({ organizationId: "clinic-a", providerIds: ["provider-a"], dateKey: "2030-01-01" });
    const slots = grid.providers[0].slots;
    const at = (time: string) => slots.find((slot) => new Date(slot.startTime).getTime() === new Date(`2030-01-01T${time}:00+05:45`).getTime())!;
    assert.equal(at("09:00").state, "BOOKED");
    assert.equal(at("09:15").state, "BOOKED");
    assert.equal(at("09:15").appointmentId, "appointment-a");
    assert.equal(at("09:30").state, bufferMinutes ? "BOOKED" : "AVAILABLE");
    assert.equal(at("09:45").state, "AVAILABLE");
    assert.equal(new Date(at("09:15").endTime).getTime(), new Date("2030-01-01T09:30:00+05:45").getTime() + bufferMinutes * 60_000);
  });
}

test("day grid with no active appointments keeps the whole interval available", async () => {
  const service = createSchedulingService(15, () => undefined, (db) => {
    db.appointment = { findMany: async ({ where }: { where: { status: { in: string[] } } }) => {
      assert.equal(where.status.in.includes("Cancelled"), true);
      assert.equal(where.status.in.includes("Completed"), false);
      return [];
    } };
  });
  const grid = await service.listScheduleGridForDay({ organizationId: "clinic-a", providerIds: ["provider-a"], dateKey: "2030-01-01" });
  const available = grid.providers[0].slots.filter((slot) => slot.state === "AVAILABLE");
  assert.equal(available.length, 4);
  assert.equal(grid.providers[0].slots.some((slot) => slot.state === "BOOKED"), false);
});


test("custom duration overrides service preset and stays isolated in the slot cache", async () => {
  const service = createSchedulingService(15, () => undefined, (db) => {
    db.service = { findMany: async () => [{ id: "service-a", durationMinutes: 45, bufferMinutes: 0 }] };
    db.providerService = { findMany: async () => [] };
  });
  const params = { organizationId: "clinic-a", providerId: "provider-a", dateKey: "2030-01-01", serviceId: "service-a" };
  const short = await service.listProviderSlots({ ...params, durationMinutes: 15 });
  const long = await service.listProviderSlots({ ...params, durationMinutes: 30 });
  const preset = await service.listProviderSlots(params);
  assert.deepEqual(short.slots.map(slot => slot.time), ["09:00", "09:15", "09:45"]);
  assert.deepEqual(long.slots.map(slot => slot.time), ["09:00"]);
  assert.equal(preset.durationMinutes, 45);
  assert.deepEqual(preset.slots, []);
  const timing = await service.getEffectiveSlotTiming({ ...params, startsAtIso: "2030-01-01T09:15:00+05:45", durationMinutes: 15 });
  assert.equal(timing.durationMinutes, 15);
});


test("day grid blocks cells that partially overlap an off-grid appointment", async () => {
  const service = createSchedulingService(15, () => undefined, (db) => {
    db.appointment = { findMany: async () => [{
      id: "off-grid", providerId: "provider-a",
      startsAt: new Date("2030-01-01T09:10:00+05:45"),
      endsAt: new Date("2030-01-01T09:25:00+05:45"),
      durationMinutes: 15, bufferMinutes: 0, status: "Scheduled",
      customer: { fullName: "Test Client" }, services: [],
    }] };
  });
  const grid = await service.listScheduleGridForDay({ organizationId: "clinic-a", providerIds: ["provider-a"], dateKey: "2030-01-01" });
  const slots = grid.providers[0].slots;
  for (const time of ["09:00", "09:10", "09:15"]) {
    assert.equal(slots.find((slot) => new Date(slot.startTime).getTime() === new Date(`2030-01-01T${time}:00+05:45`).getTime())?.state, "BOOKED");
  }
  assert.equal(slots.find((slot) => new Date(slot.startTime).getTime() === new Date("2030-01-01T09:30:00+05:45").getTime())?.state, "AVAILABLE");
});


test("cancelled grid history never occupies continuation cells and disappears when a replacement overlaps", async () => {
  for (const replacement of [false, true]) {
    const service = createSchedulingService(15, () => undefined, (db) => {
      const cancelled = { id: "cancelled", providerId: "provider-a", startsAt: new Date("2030-01-01T09:00:00+05:45"), endsAt: new Date("2030-01-01T09:30:00+05:45"), durationMinutes: 30, bufferMinutes: 0, status: "Cancelled", cancellationReason: "Client requested", customer: { fullName: "Test Client" }, services: [] };
      db.appointment = { findMany: async () => [cancelled, ...(replacement ? [{ ...cancelled, id: "new", status: "Confirmed", startsAt: new Date("2030-01-01T09:15:00+05:45"), endsAt: new Date("2030-01-01T09:45:00+05:45") }] : [])] };
    });
    const grid = await service.listScheduleGridForDay({ organizationId: "clinic-a", providerIds: ["provider-a"], dateKey: "2030-01-01" });
    const at = (time: string) => grid.providers[0].slots.find((slot) => new Date(slot.startTime).getTime() === new Date(`2030-01-01T${time}:00+05:45`).getTime())!;
    assert.equal(at("09:00").state, "AVAILABLE");
    assert.equal(at("09:00").cancelledSummary?.reason, replacement ? undefined : "Client requested");
    assert.equal(at("09:15").state, replacement ? "BOOKED" : "AVAILABLE");
    assert.equal(at("09:15").cancelledSummary, undefined);
    assert.equal(at("09:00").appointmentId, undefined);
  }
});
