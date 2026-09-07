import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { ProvidersService } from "./providers.service";

test("provider slot endpoint preserves tenant/location scope and forwards duration", async () => {
  let scheduleQuery:
    | {
        organizationId: string;
        providerId: string;
        locationId?: string;
        dateKey: string;
        durationMinutes?: number;
      }
    | undefined;

  const prisma = {
    provider: {
      findFirst: async (query: {
        where: { id: string; organizationId: string };
      }) => {
        assert.deepEqual(query.where, {
          id: "provider-a",
          organizationId: "clinic-a",
        });
        return { id: "provider-a" };
      },
    },
  };
  const auth = {
    requireSession: async () => ({
      id: "staff-a",
      organizationId: "clinic-a",
      role: "Receptionist",
      effectiveRoles: ["Receptionist"],
      effectiveRoleScopes: [
        { role: "Receptionist", locationId: "location-a" },
      ],
    }),
  };
  const scheduling = {
    listProviderSlots: async (query: typeof scheduleQuery) => {
      scheduleQuery = query;
      return { slots: [] };
    },
  };
  const service = new ProvidersService(
    prisma as never,
    auth as never,
    scheduling as never,
  );

  await service.listSlots(
    "provider-a",
    {
      organizationId: "clinic-a",
      locationId: "location-a",
      date: "2030-01-01",
      durationMinutes: 45,
    },
    "session",
  );

  assert.deepEqual(scheduleQuery, {
    organizationId: "clinic-a",
    providerId: "provider-a",
    dateKey: "2030-01-01",
    locationId: "location-a",
    serviceId: undefined,
    durationMinutes: 45,
    excludeAppointmentId: undefined,
  });
});
