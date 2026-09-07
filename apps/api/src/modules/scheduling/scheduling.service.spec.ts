import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "@nestjs/common";

import { ScheduleCacheService } from "./schedule-cache.service";
import { SchedulingService } from "./scheduling.service";

function createSchedulingService(
  slotStartIntervalMinutes = 15,
  onConfigurationRead: () => void = () => undefined,
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

  return new SchedulingService(
    prisma as never,
    new ScheduleCacheService(),
  );
}

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
