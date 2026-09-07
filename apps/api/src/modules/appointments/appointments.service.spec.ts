import assert from "node:assert/strict";
import test from "node:test";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";

import { AppointmentsService } from "./appointments.service";

const actor = {
  id: "staff-a",
  organizationId: "clinic-a",
  role: "Receptionist",
  effectiveRoles: ["Receptionist"],
};

test("appointment range carries directory-safe labels without a Client directory preload", async () => {
  let query: { where?: unknown; include?: Record<string, unknown> } | undefined;
  const service = new AppointmentsService(
    {
      appointment: {
        findMany: async (args: { where?: unknown; include?: Record<string, unknown> }) => {
          query = args;
          return [{
            id: "appointment-a",
            organizationId: "clinic-a",
            locationId: "location-a",
            customerId: "client-a",
            providerId: "provider-a",
            resourceId: null,
            startsAt: new Date("2030-01-01T03:15:00.000Z"),
            endsAt: new Date("2030-01-01T03:45:00.000Z"),
            durationMinutes: 30,
            bufferMinutes: 10,
            status: "Scheduled",
            priority: "Normal",
            communicationState: "Unconfirmed",
            notes: null,
            resource: null,
            customer: { id: "client-a", fullName: "Client A", patientCode: "CL-1" },
            provider: { id: "provider-a", displayName: "Dr A", color: "#0f766e", specialty: "General" },
            services: [{
              serviceId: "service-a",
              service: { id: "service-a", name: "Exam", category: "Care", durationMinutes: 30, bufferMinutes: 10 },
            }],
          }];
        },
      },
    } as never,
    { requireSession: async () => actor } as never,
    {} as never,
  );

  const [appointment] = await service.list({}, "cookie-session");
  assert.deepEqual(appointment.clientSummary, {
    id: "client-a",
    name: "Client A",
    patientCode: "CL-1",
  });
  assert.equal(appointment.providerSummary?.name, "Dr A");
  assert.equal(appointment.serviceSummaries[0]?.name, "Exam");
  assert.match(JSON.stringify(query?.where), /clinic-a/);
  assert.ok(query?.include?.customer, "range query must select the directory-safe Client label");
  assert.ok(query?.include?.provider, "range query must select the provider label");
});

test("appointment create returns a clear provider conflict when the database overlap guard rejects the slot", async () => {
  let checkedDurationMinutes: number | undefined;
  const prisma = {
    customer: {
      findFirst: async () => ({ id: "client-a" }),
    },
    provider: {
      findFirst: async () => ({
        id: "provider-a",
        organizationId: "clinic-a",
        status: "Available",
        user: { status: "Active" },
      }),
    },
    resource: {
      findFirst: async () => null,
    },
    $transaction: async () => {
      throw new Error(
        'ERROR: conflicting key value violates exclusion constraint "Appointment_provider_time_no_overlap" SQLSTATE 23P01',
      );
    },
  };
  const scheduling = {
    getServiceTiming: async () => ({ durationMinutes: 30, serviceBufferMinutes: 0 }),
    assertSlotAvailable: async ({ durationMinutes }: { durationMinutes: number }) => {
      checkedDurationMinutes = durationMinutes;
    },
  };
  const service = new AppointmentsService(
    prisma as never,
    { requireSession: async () => actor } as never,
    scheduling as never,
  );

  await assert.rejects(
    service.create({
      organizationId: "clinic-a",
      customerId: "client-a",
      providerId: "provider-a",
      serviceIds: ["service-a"],
      startsAtIso: "2030-01-01T09:00:00.000Z",
      durationMinutes: 60,
      bufferMinutes: 0,
      priority: "Normal",
    }),
    (error) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(error.message, "Slot no longer available for the selected provider");
      assert.equal(checkedDurationMinutes, 60);
      return true;
    },
  );
});

function bookingServiceForClient(
  client: {
    id: string;
    archivedAt: Date | null;
    mergedIntoCustomerId: string | null;
  } | null,
  holds: Array<Record<string, unknown>> = [],
) {
  let createdAppointment = false;
  let consumedHold = false;
  const prisma = {
    customer: {
      findFirst: async () => client,
    },
    provider: {
      findFirst: async () => ({
        id: "provider-a",
        organizationId: "clinic-a",
        status: "Available",
        user: { status: "Active" },
      }),
    },
    resource: {
      findFirst: async () => null,
    },
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: async () => [{ id: "provider-a" }],
        bookingSlotHold: {
          findMany: async () => holds,
          updateMany: async () => {
            consumedHold = true;
            return { count: 1 };
          },
        },
        appointment: {
          create: async () => {
            createdAppointment = true;
            return { id: "appointment-a" };
          },
        },
        auditLog: {
          create: async () => ({ id: "audit-a" }),
        },
      }),
  };
  const scheduling = {
    getServiceTiming: async () => ({ durationMinutes: 30, serviceBufferMinutes: 0 }),
    assertSlotAvailable: async () => undefined,
    invalidateAppointmentPlanning: () => undefined,
  };

  return {
    service: new AppointmentsService(
      prisma as never,
      { requireSession: async () => actor } as never,
      scheduling as never,
    ),
    wasCreated: () => createdAppointment,
    wasHoldConsumed: () => consumedHold,
  };
}

const lifecycleBooking = {
  organizationId: "clinic-a",
  customerId: "client-a",
  providerId: "provider-a",
  serviceIds: ["service-a"],
  startsAtIso: "2030-01-01T09:00:00.000Z",
  durationMinutes: 30,
  bufferMinutes: 0,
  priority: "Normal" as const,
};

test("appointment create allows an active client", async () => {
  const { service, wasCreated } = bookingServiceForClient({
    id: "client-a",
    archivedAt: null,
    mergedIntoCustomerId: null,
  });

  assert.deepEqual(await service.create(lifecycleBooking), { id: "appointment-a" });
  assert.equal(wasCreated(), true);
});

test("appointment create respects another actor's active slot hold", async () => {
  const startsAt = new Date(lifecycleBooking.startsAtIso);
  const { service, wasCreated } = bookingServiceForClient(
    {
      id: "client-a",
      archivedAt: null,
      mergedIntoCustomerId: null,
    },
    [
      {
        id: "hold-other",
        organizationId: "clinic-a",
        locationId: "location-a",
        providerId: "provider-a",
        serviceId: "service-a",
        createdByUserId: "other-user",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        bufferMinutes: 0,
        expiresAt: new Date(startsAt.getTime() + 60_000),
        releasedAt: null,
        consumedAt: null,
      },
    ],
  );

  await assert.rejects(service.create(lifecycleBooking), ConflictException);
  assert.equal(wasCreated(), false);
});

test("appointment create consumes the actor's exact active slot hold", async () => {
  const startsAt = new Date(lifecycleBooking.startsAtIso);
  const heldBooking = {
    ...lifecycleBooking,
    locationId: "location-a",
    holdId: "hold-own",
  };
  const { service, wasCreated, wasHoldConsumed } = bookingServiceForClient(
    {
      id: "client-a",
      archivedAt: null,
      mergedIntoCustomerId: null,
    },
    [
      {
        id: "hold-own",
        organizationId: "clinic-a",
        locationId: "location-a",
        providerId: "provider-a",
        serviceId: "service-a",
        createdByUserId: actor.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        bufferMinutes: 0,
        expiresAt: new Date(startsAt.getTime() + 60_000),
        releasedAt: null,
        consumedAt: null,
      },
    ],
  );

  assert.deepEqual(await service.create(heldBooking), { id: "appointment-a" });
  assert.equal(wasCreated(), true);
  assert.equal(wasHoldConsumed(), true);
});

test("appointment create rejects an archived client without disclosing lifecycle details", async () => {
  const { service, wasCreated } = bookingServiceForClient({
    id: "client-a",
    archivedAt: new Date("2029-12-01T00:00:00.000Z"),
    mergedIntoCustomerId: null,
  });

  await assert.rejects(service.create(lifecycleBooking), (error) => {
    assert.ok(error instanceof ConflictException);
    assert.equal(error.message, "Selected client is unavailable for appointment booking");
    return true;
  });
  assert.equal(wasCreated(), false);
});

test("appointment create rejects a merge-secondary client without disclosing its canonical target", async () => {
  const { service, wasCreated } = bookingServiceForClient({
    id: "client-a",
    archivedAt: null,
    mergedIntoCustomerId: "client-canonical",
  });

  await assert.rejects(service.create(lifecycleBooking), (error) => {
    assert.ok(error instanceof ConflictException);
    assert.equal(error.message, "Selected client is unavailable for appointment booking");
    return true;
  });
  assert.equal(wasCreated(), false);
});

test("appointment create denies Assistant-only actors before reading booking data", async () => {
  let queried = false;
  const service = new AppointmentsService(
    {
      customer: { findFirst: async () => { queried = true; } },
      provider: { findFirst: async () => { queried = true; } },
    } as never,
    {
      requireSession: async () => ({
        ...actor,
        role: "Assistant",
        effectiveRoles: ["Assistant"],
      }),
    } as never,
    {} as never,
  );

  await assert.rejects(
    service.create(lifecycleBooking),
    ForbiddenException,
  );
  assert.equal(queried, false);
});

test("Provider-only actors cannot create an appointment for another Provider", async () => {
  let queried = false;
  const service = new AppointmentsService(
    {
      customer: { findFirst: async () => { queried = true; } },
      provider: { findFirst: async () => { queried = true; } },
    } as never,
    {
      requireSession: async () => ({
        ...actor,
        role: "Provider",
        providerId: "provider-a",
        effectiveRoles: ["Provider"],
      }),
    } as never,
    {} as never,
  );

  await assert.rejects(
    service.create({
      ...lifecycleBooking,
      providerId: "provider-b",
    }),
    ForbiddenException,
  );
  assert.equal(queried, false);
});

test("appointment status endpoint rejects arbitrary, terminal, and successor-less lifecycle transitions", async () => {
  const prisma = {
    appointment: {
      findFirst: async () => ({
        id: "appointment-a",
        organizationId: "clinic-a",
        customerId: "client-a",
        providerId: "provider-a",
        locationId: null,
        priority: "Normal",
        status: "Scheduled",
        startsAt: new Date("2030-01-01T09:00:00.000Z"),
        endsAt: new Date("2030-01-01T09:30:00.000Z"),
        bufferMinutes: 0,
      }),
    },
  };
  const service = new AppointmentsService(
    prisma as never,
    { requireSession: async () => ({ ...actor, role: "Owner", effectiveRoles: ["Owner"] }) } as never,
    {} as never,
  );

  await assert.rejects(
    service.updateStatus("appointment-a", { status: "Completed" }),
    (error) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(error.message, "Cannot transition an appointment from Scheduled to Completed");
      return true;
    },
  );
  await assert.rejects(
    service.updateStatus("appointment-a", { status: "Rescheduled", note: "Move it" }),
    (error) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(error.message, /governed reschedule command/);
      return true;
    },
  );
  await assert.rejects(
    service.updateStatus("appointment-a", { status: "Cancelled" }),
    (error) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(error.message, "Cancellation reason is required");
      return true;
    },
  );
});

test("reschedule rejects terminal appointments before it can create a successor", async () => {
  const service = new AppointmentsService(
    {
      appointment: {
        findFirst: async () => ({
          id: "appointment-a",
          organizationId: "clinic-a",
          locationId: null,
          providerId: "provider-a",
          status: "Completed",
          startsAt: new Date("2030-01-01T09:00:00.000Z"),
          services: [],
        }),
      },
    } as never,
    { requireSession: async () => actor } as never,
    {} as never,
  );

  await assert.rejects(
    service.reschedule("appointment-a", {
      organizationId: "clinic-a",
      customerId: "client-a",
      providerId: "provider-a",
      serviceIds: ["service-a"],
      startsAtIso: "2030-01-02T09:00:00.000Z",
      durationMinutes: 30,
      bufferMinutes: 0,
      priority: "Normal",
      reason: "Client requested a new date",
    }),
    (error) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(error.message, "Only scheduled or confirmed appointments can be rescheduled");
      return true;
    },
  );
});

test("Provider-only actors cannot reschedule their own appointment onto another Provider", async () => {
  let queried = false;
  const service = new AppointmentsService(
    {
      appointment: { findFirst: async () => { queried = true; } },
    } as never,
    {
      requireSession: async () => ({
        ...actor,
        role: "Provider",
        providerId: "provider-a",
        effectiveRoles: ["Provider"],
      }),
    } as never,
    {} as never,
  );

  await assert.rejects(
    service.reschedule("appointment-a", {
      ...lifecycleBooking,
      providerId: "provider-b",
      reason: "Move to another Provider",
    }),
    ForbiddenException,
  );
  assert.equal(queried, false);
});
