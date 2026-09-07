import assert from "node:assert/strict";
import test from "node:test";

import type { AppointmentsService } from "../appointments/appointments.service";
import type { ProvidersService } from "../providers/providers.service";
import type { ScheduleBootstrapService } from "./schedule-bootstrap.service";
import { ScheduleV1Controller } from "./schedule-v1.controller";

test("v1 day snapshot scopes both reads to the requested providers and Nepal date", async () => {
  let appointmentQuery: Record<string, unknown> | undefined;
  let gridQuery: Record<string, unknown> | undefined;
  const controller = new ScheduleV1Controller(
    {} as ScheduleBootstrapService,
    {
      list: async (query: Record<string, unknown>) => {
        appointmentQuery = query;
        return [{ id: "appointment-1" }];
      },
    } as unknown as AppointmentsService,
    {
      listScheduleGrids: async (query: Record<string, unknown>) => {
        gridQuery = query;
        return { date: "2026-08-15", providers: [] };
      },
    } as unknown as ProvidersService,
  );

  const response = await controller.day(
    {
      organizationId: "clinic-1",
      date: "2026-08-15",
      locationId: "location-1",
      providerIds: "provider-1,provider-2",
    },
    { requestId: "request-1" },
    undefined,
  );

  assert.deepEqual(appointmentQuery, {
    fromIso: "2026-08-14T18:15:00.000Z",
    toIso: "2026-08-15T18:14:59.999Z",
    providerIds: ["provider-1", "provider-2"],
    locationId: "location-1",
  });
  assert.deepEqual(gridQuery, {
    organizationId: "clinic-1",
    dateIso: "2026-08-15",
    locationId: "location-1",
    providerIds: "provider-1,provider-2",
  });
  assert.deepEqual(response, {
    data: {
      appointments: [{ id: "appointment-1" }],
      grid: { date: "2026-08-15", providers: [] },
    },
    meta: { apiVersion: "v1", requestId: "request-1" },
  });
});
