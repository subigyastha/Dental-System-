import assert from "node:assert/strict";
import test from "node:test";

import type { BookingBootstrap } from "../../lib/booking-bootstrap";
import type { Location, Provider, Service } from "../../lib/domain";
import {
  effectiveBookingService,
  resolveAppointmentBookingReferences,
  servicesForBookingProvider,
} from "./appointment-booking-references";

const bootstrap: BookingBootstrap = {
  context: {
    organization: { id: "organization-a", timezone: "Asia/Kathmandu" },
    actor: { id: "user-a", providerId: null },
    permissions: { canCreateAppointment: true, providerScope: "any" },
  },
  bookingDefaults: {
    dateInputCalendar: "AD",
    showBsDateEquivalent: true,
    slotIntervalMinutes: 15,
    bufferMinutes: 5,
    holdMinutes: 3,
    defaultLocationId: "location-a",
    defaultProviderId: "provider-a",
  },
  location: {
    id: "location-a",
    name: "Jawalakhel",
    timezone: "Asia/Kathmandu",
  },
  providers: [
    {
      id: "provider-a",
      name: "Dr A",
      roleLabel: "Dentist",
      specialty: null,
      status: "Available",
      color: "#123456",
      serviceOptions: [
        {
          serviceId: "service-a",
          durationMinutes: 45,
          bufferMinutes: 10,
        },
      ],
    },
  ],
  services: [
    {
      id: "service-a",
      name: "Checkup",
      category: "General",
      durationMinutes: 30,
      bufferMinutes: 5,
    },
    {
      id: "service-b",
      name: "Cleaning",
      category: "General",
      durationMinutes: 60,
      bufferMinutes: 0,
    },
  ],
};

const legacyLocation: Location = {
  id: "legacy-location",
  organizationId: "organization-a",
  name: "Legacy clinic",
  timezone: "Asia/Kathmandu",
  isActive: true,
};
const legacyServices: Service[] = [
  {
    id: "legacy-service",
    name: "Legacy service",
    category: "General",
    durationMinutes: 60,
    bufferMinutes: 0,
  },
];
const legacyProviders: Provider[] = [
  {
    id: "legacy-provider",
    name: "Legacy provider",
    roleLabel: "Dentist",
    specialty: "",
    color: "#000000",
    capacityMinutes: 0,
    bookedMinutes: 0,
    status: "Available",
    availability: [],
    recurringBlocks: [],
    blockedTimes: [],
    serviceIds: ["legacy-service"],
  },
];

test("new booking references are location-scoped to the explicit bootstrap", () => {
  const references = resolveAppointmentBookingReferences({
    bookingBootstrap: bootstrap,
    legacyLocation,
    legacyProviders,
    legacyServices,
    locationId: "location-a",
    useLegacyReferences: false,
  });

  assert.equal(references.locationName, "Jawalakhel");
  assert.equal(references.defaultProviderId, "provider-a");
  assert.deepEqual(
    servicesForBookingProvider(references, "provider-a").map(
      (service) => service.id,
    ),
    ["service-a"],
  );
  assert.deepEqual(
    effectiveBookingService(references, "provider-a", "service-a"),
    {
      id: "service-a",
      name: "Checkup",
      durationMinutes: 45,
      bufferMinutes: 10,
    },
  );
});

test("a bootstrap for another location fails closed", () => {
  const references = resolveAppointmentBookingReferences({
    bookingBootstrap: bootstrap,
    legacyLocation,
    legacyProviders,
    legacyServices,
    locationId: "location-b",
    useLegacyReferences: false,
  });

  assert.equal(references.providers.length, 0);
  assert.match(references.error ?? "", /selected clinic location/i);
});

test("new booking does not fall back to large operational references", () => {
  const references = resolveAppointmentBookingReferences({
    legacyLocation,
    legacyProviders,
    legacyServices,
    locationId: "legacy-location",
    useLegacyReferences: false,
  });

  assert.equal(references.providers.length, 0);
  assert.match(references.error ?? "", /still loading/i);
});

test("edit and reschedule retain legacy reference compatibility", () => {
  const references = resolveAppointmentBookingReferences({
    bookingBootstrap: bootstrap,
    legacyLocation,
    legacyProviders,
    legacyServices,
    useLegacyReferences: true,
  });

  assert.equal(references.locationId, "legacy-location");
  assert.equal(references.providers[0]?.id, "legacy-provider");
  assert.equal(references.services[0]?.id, "legacy-service");
});
