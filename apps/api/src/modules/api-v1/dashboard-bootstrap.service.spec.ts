import assert from "node:assert/strict";
import test from "node:test";

import {
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { DashboardBootstrapService } from "./dashboard-bootstrap.service";
import { v1Envelope, v1ErrorBody } from "./v1-contract";

const actor = {
  id: "user-a",
  organizationId: "clinic-a",
  name: "Clinic A Admin",
  email: "admin@clinic-a.test",
  role: UserRole.Admin,
};

test("v1 dashboard bootstrap is tenant-scoped, bounded, and includes role context", async () => {
  const observed: unknown[] = [];
  const now = new Date("2030-01-01T08:00:00.000Z");
  const prisma = {
    organization: { findFirst: async (query: unknown) => { observed.push(query); return { id: "clinic-a", name: "Clinic A", timezone: "Asia/Kathmandu", primaryCalendar: "AD", _count: { customers: 8 } }; } },
    appointment: {
      count: async (query: unknown) => { observed.push(query); return 3; },
      findMany: async (query: unknown) => {
        observed.push(query);
        return ["a1", "a2", "a3"].map((id, index) => ({
          id, startsAt: new Date(now.getTime() + index * 60_000), endsAt: new Date(now.getTime() + (index + 30) * 60_000),
          status: "Scheduled", priority: "Normal",
          customer: { id: `client-${id}`, fullName: `Client ${id}`, patientCode: null },
          provider: { id: "provider-a", displayName: "Dr A" }, location: null,
        }));
      },
    },
    followUpTask: {
      count: async (query: unknown) => { observed.push(query); return 1; },
      findMany: async (query: unknown) => {
        observed.push(query);
        return [{ id: "f1", dueAt: now, status: "Open", priority: "High", type: "Reminder", summary: "Call client", nextAction: "Call", customer: { id: "client-a", fullName: "Client A", patientCode: "CL-1" } }];
      },
    },
  };
  const service = new DashboardBootstrapService(
    prisma as never,
    {
      requireSession: async () => ({
        ...actor,
        effectiveRoles: [UserRole.Provider, UserRole.Finance],
        effectiveRoleScopes: [
          { role: UserRole.Provider, locationId: "location-a" },
          { role: UserRole.Finance, locationId: "location-b" },
        ],
        authorizationRoleSource: "assignment_policy",
      }),
    } as never,
  );

  const result = await service.getBootstrap(2, actor, now);
  assert.deepEqual(result.context.actor.roles, [UserRole.Provider, UserRole.Finance]);
  assert.equal(result.context.actor.roleSource, "assignment_policy");
  assert.ok(result.context.actor.capabilities.includes("dashboard.read"));
  assert.deepEqual(result.summary, {
    activeClientCount: 8,
    appointmentsNext24Hours: 3,
    overdueFollowUpCount: 1,
    generatedAtIso: now.toISOString(),
  });
  assert.equal(result.schedule.items.length, 2);
  assert.deepEqual(result.schedule.page, { limit: 2, count: 2, hasMore: true });
  assert.equal(result.followUps.items[0].client.name, "Client A");
  assert.ok(observed.every((query) => JSON.stringify(query).includes("clinic-a")), "every data query must use the actor's organization scope");
  const scheduleQuery = observed.find((query) => JSON.stringify(query).includes('"take":3')) as { take: number };
  assert.equal(scheduleQuery.take, 3, "collection reads request only limit + 1 rows");
  const serializedQueries = observed.map((query) => JSON.stringify(query));
  const appointmentQueries = serializedQueries.filter((query) =>
    query.includes('"startsAt"'),
  );
  const followUpQueries = serializedQueries.filter((query) =>
    query.includes('"dueAt"'),
  );
  assert.ok(
    appointmentQueries.every((query) =>
      query.includes('"locationId":{"in":["location-a"]}'),
    ),
    "appointment reads must use only the actor's clinic-operator location scope",
  );
  assert.ok(
    followUpQueries.every((query) =>
      query.includes(
        '"appointment":{"is":{"locationId":{"in":["location-a"]}}}',
      ),
    ),
    "follow-up reads must be related to an appointment in the permitted location",
  );
});

test("v1 dashboard rejects non-clinic users", async () => {
  const service = new DashboardBootstrapService(
    {} as never,
    { requireSession: async () => ({ ...actor, role: UserRole.Client }) } as never,
  );
  await assert.rejects(service.getBootstrap(12, actor), ForbiddenException);
});

test("v1 dashboard normalizes an HTTP query-string limit before passing it to Prisma", async () => {
  const takes: unknown[] = [];
  const now = new Date("2030-01-01T08:00:00.000Z");
  const service = new DashboardBootstrapService(
    {
      organization: {
        findFirst: async () => ({
          id: "clinic-a",
          name: "Clinic A",
          timezone: "Asia/Kathmandu",
          primaryCalendar: "AD",
          _count: { customers: 0 },
        }),
      },
      appointment: {
        count: async () => 0,
        findMany: async ({ take }: { take: unknown }) => {
          takes.push(take);
          return [];
        },
      },
      followUpTask: {
        count: async () => 0,
        findMany: async ({ take }: { take: unknown }) => {
          takes.push(take);
          return [];
        },
      },
    } as never,
    { requireSession: async () => actor } as never,
  );

  const result = await service.getBootstrap("12", actor, now);

  assert.deepEqual(takes, [13, 13]);
  assert.equal(result.schedule.page.limit, 12);
  assert.equal(result.followUps.page.limit, 12);
});

test("v1 envelope and errors have stable versioned shapes", () => {
  assert.deepEqual(v1Envelope({ ready: true }, "request-1"), {
    data: { ready: true },
    meta: { apiVersion: "v1", requestId: "request-1" },
  });
  assert.deepEqual(v1ErrorBody(new ForbiddenException("Denied"), "request-1"), {
    status: 403,
    body: {
      error: { code: "forbidden", message: "Denied" },
      meta: { apiVersion: "v1", requestId: "request-1" },
    },
  });
});

test("v1 errors preserve safe domain reasons without replacing the stable code", () => {
  const result = v1ErrorBody(
    new ConflictException({
      code: "HOLD_EXPIRED",
      message: "The selected hold expired.",
    }),
    "request-2",
  );
  assert.deepEqual(result.body.error, {
    code: "conflict",
    reason: "HOLD_EXPIRED",
    message: "The selected hold expired.",
  });
});
