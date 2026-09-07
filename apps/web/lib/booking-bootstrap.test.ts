import assert from "node:assert/strict";
import test from "node:test";

import {
  createBookingBootstrapLoader,
  unwrapBookingBootstrap,
  type BookingBootstrapEnvelope,
} from "./booking-bootstrap";

function envelope(locationId = "location-a"): BookingBootstrapEnvelope {
  return {
    data: {
      context: {
        organization: {
          id: "clinic-a",
          timezone: "Asia/Kathmandu",
        },
        actor: {
          id: "user-a",
          providerId: null,
        },
        permissions: {
          canCreateAppointment: true,
          providerScope: "any",
        },
      },
      bookingDefaults: {
        dateInputCalendar: "AD",
        showBsDateEquivalent: true,
        slotIntervalMinutes: 15,
        bufferMinutes: 10,
        holdMinutes: 3,
        defaultLocationId: locationId,
        defaultProviderId: null,
      },
      location: {
        id: locationId,
        name: "Main clinic",
        timezone: "Asia/Kathmandu",
      },
      providers: [],
      services: [],
    },
    meta: {
      apiVersion: "v1",
    },
  };
}

test("booking bootstrap accepts only v1 data for the requested location", () => {
  assert.equal(
    unwrapBookingBootstrap(envelope(), "location-a").location.id,
    "location-a",
  );
  assert.throws(
    () =>
      unwrapBookingBootstrap(
        {
          ...envelope(),
          meta: { apiVersion: "v2" as "v1" },
        },
        "location-a",
      ),
    /unsupported response/,
  );
  assert.throws(
    () => unwrapBookingBootstrap(envelope("location-b"), "location-a"),
    /another location/,
  );
});

test("booking bootstrap loader deduplicates requests per location", async () => {
  let requests = 0;
  const loader = createBookingBootstrapLoader(async (locationId) => {
    requests += 1;
    return envelope(locationId);
  });

  const [first, second] = await Promise.all([
    loader.load("location-a"),
    loader.load("location-a"),
  ]);

  assert.equal(first, second);
  assert.equal(requests, 1);
  await loader.load("location-b");
  assert.equal(requests, 2);
});

test("failed booking bootstrap requests remain retryable", async () => {
  let requests = 0;
  const loader = createBookingBootstrapLoader(async (locationId) => {
    requests += 1;
    if (requests === 1) {
      throw new Error("Temporary failure");
    }
    return envelope(locationId);
  });

  await assert.rejects(loader.load("location-a"), /Temporary failure/);
  assert.equal((await loader.load("location-a")).location.id, "location-a");
  assert.equal(requests, 2);
});

test("clearing the loader drops session-local booking references", async () => {
  let requests = 0;
  const loader = createBookingBootstrapLoader(async (locationId) => {
    requests += 1;
    return envelope(locationId);
  });

  await loader.load("location-a");
  loader.clear();
  await loader.load("location-a");
  assert.equal(requests, 2);
});
