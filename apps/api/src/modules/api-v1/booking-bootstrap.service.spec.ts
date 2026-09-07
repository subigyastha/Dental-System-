import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { BookingBootstrapService } from "./booking-bootstrap.service";
import { BookingAvailabilityController } from "./booking-availability.controller";

const providerActor = {
  id: "user-a",
  organizationId: "clinic-a",
  name: "Dr A",
  email: "provider@clinic-a.test",
  role: UserRole.Provider,
  providerId: "provider-a",
  effectiveRoles: [UserRole.Provider],
  effectiveRoleScopes: [
    { role: UserRole.Provider, locationId: "location-a" },
  ],
  authorizationRoleSource: "assignment_policy" as const,
};

function bookingRows() {
  return {
    organization: {
      id: "clinic-a",
      timezone: "Asia/Kathmandu",
      primaryCalendar: "BS",
      settings: { defaultBufferMinutes: 12 },
      name: "must-not-leak",
      email: "must-not-leak@clinic-a.test",
    },
    locations: [
      {
        id: "location-a",
        name: "Main Clinic",
        timezone: "Asia/Kathmandu",
        address: "must-not-leak",
      },
    ],
    providers: [
      {
        id: "provider-a",
        displayName: "Dr A",
        roleLabel: "Dentist",
        specialty: "General dentistry",
        status: "Available",
        color: "#0f766e",
        userId: "must-not-leak",
        providerServices: [
          {
            serviceId: "service-a",
            locationId: "location-a",
            customDurationMinutes: 45,
            customPrice: "must-not-leak",
          },
        ],
      },
    ],
    services: [
      {
        id: "service-a",
        name: "Consultation",
        category: "General",
        durationMinutes: 30,
        bufferMinutes: 5,
        price: "must-not-leak",
        description: "must-not-leak",
      },
    ],
  };
}

test("booking bootstrap is tenant, location, and Provider-self scoped", async () => {
  const rows = bookingRows();
  const queries: Array<{ delegate: string; query: unknown }> = [];
  const service = new BookingBootstrapService(
    {
      organization: {
        findFirst: async (query: unknown) => {
          queries.push({ delegate: "organization", query });
          return rows.organization;
        },
      },
      location: {
        findFirst: async (query: unknown) => {
          queries.push({ delegate: "location", query });
          return rows.locations[0];
        },
      },
      provider: {
        findMany: async (query: unknown) => {
          queries.push({ delegate: "provider", query });
          return rows.providers;
        },
      },
      service: {
        findMany: async (query: unknown) => {
          queries.push({ delegate: "service", query });
          return rows.services;
        },
      },
    } as never,
    { requireSession: async () => providerActor } as never,
  );

  const result = await service.getBootstrap("location-a", providerActor);
  const queryFor = (delegate: string) =>
    queries.find((item) => item.delegate === delegate)?.query as {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    };

  assert.deepEqual(queryFor("organization").where, {
    id: "clinic-a",
    status: "Active",
  });
  assert.deepEqual(queryFor("location").where, {
    id: "location-a",
    organizationId: "clinic-a",
    isActive: true,
  });
  assert.deepEqual(queryFor("provider").where, {
    organizationId: "clinic-a",
    status: { not: "Inactive" },
    id: "provider-a",
    OR: [
      { userId: null },
      { user: { is: { status: "Active" } } },
    ],
  });
  assert.deepEqual(
    (
      queryFor("provider").select.providerServices as {
        where: unknown;
      }
    ).where,
    {
      isActive: true,
      service: { isActive: true },
      OR: [
        { locationId: "location-a" },
        { locationId: null },
      ],
    },
  );
  assert.deepEqual(queryFor("service").where, {
    organizationId: "clinic-a",
    isActive: true,
  });
  assert.ok(
    queries.every((item) => JSON.stringify(item.query).includes("clinic-a")),
    "every top-level booking reference query must include the actor tenant",
  );

  assert.deepEqual(result.bookingDefaults, {
    dateInputCalendar: "AD",
    showBsDateEquivalent: true,
    slotIntervalMinutes: 15,
    bufferMinutes: 12,
    holdMinutes: 3,
    defaultLocationId: "location-a",
    defaultProviderId: "provider-a",
  });
  assert.deepEqual(result.context.actor, {
    id: "user-a",
    providerId: "provider-a",
  });
  assert.deepEqual(result.context.permissions, {
    canCreateAppointment: true,
    providerScope: "self",
  });
});

test("non-booking roles do not broaden a Receptionist's location scope", async () => {
  const rows = bookingRows();
  let locationWhere: unknown;
  let providerWhere: unknown;
  let providerServiceWhere: unknown;
  const service = new BookingBootstrapService(
    {
      organization: { findFirst: async () => rows.organization },
      location: {
        findFirst: async ({ where }: { where: unknown }) => {
          locationWhere = where;
          return rows.locations[0];
        },
      },
      provider: {
        findMany: async ({
          where,
          select,
        }: {
          where: unknown;
          select: { providerServices: { where: unknown } };
        }) => {
          providerWhere = where;
          providerServiceWhere = select.providerServices.where;
          return rows.providers;
        },
      },
      service: { findMany: async () => rows.services },
    } as never,
    {
      requireSession: async () => ({
        ...providerActor,
        role: UserRole.Receptionist,
        providerId: undefined,
        effectiveRoles: [UserRole.Receptionist, UserRole.Finance],
        effectiveRoleScopes: [
          { role: UserRole.Receptionist, locationId: "location-a" },
          { role: UserRole.Finance, locationId: null },
        ],
      }),
    } as never,
  );

  const result = await service.getBootstrap("location-a", providerActor);

  assert.deepEqual(locationWhere, {
    id: "location-a",
    organizationId: "clinic-a",
    isActive: true,
  });
  assert.deepEqual(providerWhere, {
    organizationId: "clinic-a",
    status: { not: "Inactive" },
    OR: [
      { userId: null },
      { user: { is: { status: "Active" } } },
    ],
  });
  assert.deepEqual(providerServiceWhere, {
    isActive: true,
    service: { isActive: true },
    OR: [
      { locationId: "location-a" },
      { locationId: null },
    ],
  });
  assert.equal(result.bookingDefaults.defaultProviderId, null);
  assert.equal(result.context.permissions.providerScope, "any");

  await assert.rejects(
    service.getBootstrap("location-b", providerActor),
    ForbiddenException,
    "a global Finance assignment must not broaden Receptionist booking beyond Location A",
  );
});

test("booking bootstrap exposes only the minimal drawer reference projection", async () => {
  const rows = bookingRows();
  const service = new BookingBootstrapService(
    {
      organization: { findFirst: async () => rows.organization },
      location: { findFirst: async () => rows.locations[0] },
      provider: { findMany: async () => rows.providers },
      service: { findMany: async () => rows.services },
    } as never,
    { requireSession: async () => providerActor } as never,
  );

  const result = await service.getBootstrap("location-a", providerActor);

  assert.deepEqual(Object.keys(result).sort(), [
    "bookingDefaults",
    "context",
    "location",
    "providers",
    "services",
  ]);
  assert.deepEqual(Object.keys(result.context.organization).sort(), [
    "id",
    "timezone",
  ]);
  assert.deepEqual(Object.keys(result.location).sort(), [
    "id",
    "name",
    "timezone",
  ]);
  assert.deepEqual(Object.keys(result.providers[0]).sort(), [
    "color",
    "id",
    "name",
    "roleLabel",
    "serviceOptions",
    "specialty",
    "status",
  ]);
  assert.deepEqual(Object.keys(result.providers[0].serviceOptions[0]).sort(), [
    "bufferMinutes",
    "durationMinutes",
    "serviceId",
  ]);
  assert.deepEqual(Object.keys(result.services[0]).sort(), [
    "bufferMinutes",
    "category",
    "durationMinutes",
    "id",
    "name",
  ]);
  for (const forbidden of [
    "appointments",
    "clients",
    "customers",
    "invoices",
    "payments",
    "followUps",
    "availability",
    "blockedTimes",
  ]) {
    assert.equal(forbidden in result, false);
  }
});

test("booking bootstrap fails closed for non-booking roles and unlinked Providers", async () => {
  let queried = false;
  const prisma = {
    organization: { findFirst: async () => { queried = true; } },
    location: { findFirst: async () => { queried = true; } },
    provider: { findMany: async () => { queried = true; } },
    service: { findMany: async () => { queried = true; } },
  };

  const finance = new BookingBootstrapService(
    prisma as never,
    {
      requireSession: async () => ({
        ...providerActor,
        role: UserRole.Finance,
        providerId: undefined,
        effectiveRoles: [UserRole.Finance],
        effectiveRoleScopes: [
          { role: UserRole.Finance, locationId: "location-a" },
        ],
      }),
    } as never,
  );
  await assert.rejects(
    finance.getBootstrap("location-a", providerActor),
    ForbiddenException,
  );
  assert.equal(queried, false);

  const unlinkedProvider = new BookingBootstrapService(
    prisma as never,
    {
      requireSession: async () => ({
        ...providerActor,
        providerId: undefined,
      }),
    } as never,
  );
  await assert.rejects(
    unlinkedProvider.getBootstrap("location-a", providerActor),
    ForbiddenException,
  );
  assert.equal(queried, false);
});

test("booking bootstrap controller marks the authenticated response private and non-cacheable", async () => {
  let cacheControl: string | undefined;
  const controller = new BookingAvailabilityController(
    {} as never,
    {
      getBootstrap: async (locationId: string) => ({ locationId }),
    } as never,
    {} as never,
  );

  const response = await controller.bootstrap(
    { locationId: "location-a" },
    { requestId: "request-a" },
    {
      setHeader(name: string, value: string) {
        if (name === "Cache-Control") cacheControl = value;
      },
    },
    providerActor,
  );

  assert.equal(cacheControl, "private, no-store");
  assert.deepEqual(response, {
    data: { locationId: "location-a" },
    meta: { apiVersion: "v1", requestId: "request-a" },
  });
});
