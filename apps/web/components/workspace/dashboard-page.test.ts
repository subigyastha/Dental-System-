import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOptimisticDashboardStatus,
  dashboardBootstrapError,
  unwrapDashboardBootstrap,
  type DashboardBootstrap,
} from "./dashboard-page";
import { ApiRequestError } from "@/lib/api-client";

const bootstrap: DashboardBootstrap = {
  context: {
    organization: { id: "org-1", name: "Clinic", timezone: "Asia/Kathmandu", primaryCalendar: "AD" },
    actor: { id: "user-1", name: "Owner", roles: ["Owner"], roleSource: "assignments", capabilities: [] },
  },
  summary: { activeClientCount: 2, appointmentsNext24Hours: 1, overdueFollowUpCount: 0, generatedAtIso: "2026-07-18T00:00:00.000Z" },
  schedule: { items: [], page: { limit: 12, count: 0, hasMore: false } },
  followUps: { items: [], page: { limit: 12, count: 0, hasMore: false } },
};

test("dashboard uses the v1 envelope and rejects unknown response versions", () => {
  assert.equal(unwrapDashboardBootstrap({ data: bootstrap, meta: { apiVersion: "v1" } }), bootstrap);
  assert.throws(
    () => unwrapDashboardBootstrap({ data: bootstrap, meta: { apiVersion: "v2" as "v1" } }),
    /unsupported response/,
  );
});

test("dashboard renders permission failures as a persistent error state", () => {
  assert.equal(
    dashboardBootstrapError(new ApiRequestError("forbidden", 403)),
    "You do not have permission to view this dashboard.",
  );
});

test("dashboard status updates are optimistic and remove completed work", () => {
  const withAppointment: DashboardBootstrap = {
    ...bootstrap,
    schedule: {
      items: [
        {
          id: "appointment-1",
          startsAtIso: "2026-08-15T04:15:00.000Z",
          endsAtIso: "2026-08-15T05:15:00.000Z",
          status: "Scheduled",
          priority: "Normal",
          client: { id: "client-1", name: "Client", clientCode: "CL-1" },
          provider: { id: "provider-1", name: "Provider" },
          location: { id: "location-1", name: "Main" },
        },
      ],
      page: { limit: 12, count: 1, hasMore: false },
    },
  };

  const confirmed = applyOptimisticDashboardStatus(
    withAppointment,
    "appointment-1",
    "Confirmed",
  );
  assert.equal(confirmed.schedule.items[0]?.status, "Confirmed");
  assert.equal(confirmed.summary.appointmentsNext24Hours, 1);

  const completed = applyOptimisticDashboardStatus(
    withAppointment,
    "appointment-1",
    "Completed",
  );
  assert.equal(completed.schedule.items.length, 0);
  assert.equal(completed.schedule.page.count, 0);
  assert.equal(completed.summary.appointmentsNext24Hours, 0);
});
