import assert from "node:assert/strict";
import test from "node:test";

import {
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
