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

function rescheduleFixture(options: { claimCount?: number; conflict?: boolean; durationMinutes?: number } = {}) {
  const calls: string[] = [];
  let excludedId: string | undefined;
  const tx = {
    $queryRaw: async () => [{ id: "provider-a", now: new Date("2029-01-01") }],
    bookingSlotHold: { findMany: async () => [] },
    appointment: {
      updateMany: async (args: { where: unknown }) => {
        calls.push("claim");
        assert.deepEqual(args.where, {
          id: "appointment-a",
          organizationId: "clinic-a",
          status: { in: ["Scheduled", "Confirmed"] },
        });
        return { count: options.claimCount ?? 1 };
      },
      create: async (args: { data: { sourceAppointmentId: string; startsAt: Date; endsAt: Date } }) => {
        calls.push("create");
        assert.equal(args.data.sourceAppointmentId, "appointment-a");
        assert.equal(args.data.startsAt.toISOString(), "2030-01-01T08:15:00.000Z");
        assert.equal(args.data.endsAt.getTime(), args.data.startsAt.getTime() + (options.durationMinutes ?? 30) * 60_000);
        return { id: "successor-a" };
      },
    },
    workflowEvent: { createMany: async () => undefined },
    auditLog: { create: async () => undefined },
  };
  const service = new AppointmentsService({
    appointment: { findFirst: async () => ({
      id: "appointment-a", organizationId: "clinic-a", locationId: null,
      providerId: "provider-a", status: "Scheduled",
      startsAt: new Date("2030-01-01T08:00:00.000Z"), services: [],
    }) },
    invoice: { count: async () => 0 },
    payment: { count: async () => 0 },
    customer: { findFirst: async () => ({ id: "client-a" }) },
    provider: { findFirst: async () => ({ id: "provider-a", status: "Available" }) },
    $transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
  } as never, { requireSession: async () => actor } as never, {
    getServiceTiming: async () => ({ durationMinutes: 30, serviceBufferMinutes: 10 }),
    assertSlotAvailable: async (args: { excludeAppointmentId?: string; durationMinutes: number; bufferMinutes: number }) => {
      excludedId = args.excludeAppointmentId;
      assert.equal(args.durationMinutes, options.durationMinutes ?? 30);
      assert.equal(args.bufferMinutes, 10, "configured service buffer is preserved");
      if (options.conflict) throw new ConflictException("Another appointment occupies this time");
    },
    invalidateAppointmentPlanning: () => undefined,
  } as never);
  return {
    calls,
    excludedId: () => excludedId,
    run: () => service.reschedule("appointment-a", {
      organizationId: "clinic-a", customerId: "client-a", providerId: "provider-a",
      serviceIds: ["service-a"], startsAtIso: "2030-01-01T08:15:00.000Z",
      durationMinutes: options.durationMinutes ?? 30, bufferMinutes: 0, priority: "Normal", reason: "Client requested 15 minutes later",
    }),
  };
}

test("reschedule shifts a 30-minute visit by 15 minutes excluding only its original appointment", async () => {
  const fixture = rescheduleFixture();
  assert.deepEqual(await fixture.run(), {
    originalAppointmentId: "appointment-a", successorAppointmentId: "successor-a",
  });
  assert.equal(fixture.excludedId(), "appointment-a");
  assert.deepEqual(fixture.calls, ["claim", "create"]);
});

test("reschedule still rejects another appointment occupying the shifted time", async () => {
  const fixture = rescheduleFixture({ conflict: true });
  await assert.rejects(fixture.run(), ConflictException);
  assert.equal(fixture.excludedId(), "appointment-a");
  assert.deepEqual(fixture.calls, []);
});

test("reschedule cannot create a second successor after the original changed", async () => {
  const fixture = rescheduleFixture({ claimCount: 0 });
  await assert.rejects(fixture.run(), ConflictException);
  assert.deepEqual(fixture.calls, ["claim"]);
});

test("reschedule preserves a custom period shorter than the service preset and keeps its buffer", async () => {
  const fixture = rescheduleFixture({ durationMinutes: 15 });
  await fixture.run();
  assert.deepEqual(fixture.calls, ["claim", "create"]);
});

test("reschedule rejects invalid custom periods before changing the original", async () => {
  for (const durationMinutes of [0, -1, 1.5, 1441, NaN]) {
    const fixture = rescheduleFixture({ durationMinutes });
    await assert.rejects(fixture.run(), BadRequestException);
    assert.deepEqual(fixture.calls, []);
  }
});

function completionFixture(options: { initialStatus?: string; session?: unknown; activeRecall?: unknown; latestVisit?: unknown; concurrentCompleted?: boolean; failRecall?: boolean; existingPostVisit?: unknown; failPostVisit?: boolean } = {}) {
  const writes: Array<{ kind: string; data: Record<string, unknown> }> = [];
  const appointment = {
    id: "visit-a", organizationId: "clinic-a", customerId: "client-a", providerId: "provider-a", locationId: "location-a",
    priority: "Normal", status: options.initialStatus ?? "CheckedIn", startsAt: new Date("2026-08-31T09:00:00+05:45"),
    endsAt: new Date("2026-08-31T09:30:00+05:45"), bufferMinutes: 0,
  };
  let locked = false;
  const tx = {
    $queryRaw: async (sql: { strings: string[]; values: unknown[] }) => {
      assert.match(sql.strings.join(""), /Customer.*organizationId.*FOR UPDATE/);
      assert.ok(sql.values.includes("clinic-a"));
      locked = true;
      return [{ id: "client-a" }];
    },
    appointment: {
      updateMany: async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
        assert.equal(where.organizationId, "clinic-a");
        assert.equal(where.status, appointment.status);
        if (options.concurrentCompleted) return { count: 0 };
        writes.push({ kind: "appointment", data }); appointment.status = String(data.status);
        return { count: 1 };
      },
      findFirst: async () => options.concurrentCompleted ? { id: appointment.id } : options.latestVisit ?? appointment,
    },
    workflowEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ kind: "event", data }); } },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ kind: "audit", data }); } },
    followUpTask: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(locked, true);
        assert.equal(where.organizationId, "clinic-a");
        assert.equal(where.customerId, "client-a");
        if (where.type === "TreatmentContinuation") {
          assert.equal(where.appointmentId, appointment.id);
          assert.equal(where.status, undefined, "finished visit tasks must also prevent duplicates");
          return options.existingPostVisit ?? null;
        }
        assert.equal(where.type, "Recall", "case-specific tasks cannot be overwritten by recall planning");
        return options.activeRecall ?? null;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ kind: "recall-update", data }); },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.type === "TreatmentContinuation") {
          if (options.failPostVisit) throw new Error("Post-visit insert failed");
          writes.push({ kind: "post-visit-create", data });
          return { id: "post-visit-a" };
        }
        if (options.failRecall) throw new Error("Recall insert failed");
        writes.push({ kind: "recall-create", data });
        return { id: "recall-a" };
      },
    },
  };
  const service = new AppointmentsService({
    appointment: { findFirst: async () => ({ ...appointment }) },
    $transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => {
      const statusBefore = appointment.status;
      try { return await run(tx); } catch (error) { writes.splice(0); appointment.status = statusBefore; throw error; }
    },
  } as never, { requireSession: async () => options.session ?? actor } as never, { invalidateAppointmentPlanning: () => undefined } as never);
  return { service, writes, appointment };
}

test("completion records the transition and history without creating or changing any follow-ups", async () => {
  for (const initialStatus of ["CheckedIn", "InProgress"]) {
    const f = completionFixture({ initialStatus });
    await f.service.complete("visit-a");
    assert.equal(f.appointment.status, "Completed");
    assert.deepEqual(f.writes.map(row => row.kind), ["appointment", "event", "audit"]);
    await f.service.complete("visit-a");
    assert.equal(f.writes.length, 3);
  }
});

test("completion preserves every existing reminder and does not consult automatic scheduling", async () => {
  for (const options of [{ failRecall: true }, { failPostVisit: true }, { activeRecall: { id: "staff-plan" } }, { existingPostVisit: { id: "staff-review" } }]) {
    const f = completionFixture(options); await f.service.complete("visit-a");
    assert.deepEqual(f.writes.map(row => row.kind), ["appointment", "event", "audit"]);
  }
  const concurrent = completionFixture({ concurrentCompleted: true });
  await concurrent.service.complete("visit-a"); assert.equal(concurrent.writes.length, 0);
});

test("cancelled and missed visits do not create recovery reminders automatically", async () => {
  for (const status of ["Cancelled", "NoShow"] as const) {
    const f = completionFixture({ initialStatus: "Confirmed" });
    await f.service.updateStatus("visit-a", { status, note: "Client called" });
    assert.deepEqual(f.writes.map(row => row.kind), ["appointment", "event", "audit"]);
  }
});

test("completion authority uses roles at the visit location and rejects locationless scoped grants", async () => {
  for (const options of [
    { session: { ...actor, effectiveRoleScopes: [{ role: "Receptionist", locationId: "location-b" }] } },
    { session: { ...actor, providerId: "provider-b", effectiveRoles: ["Receptionist", "Provider"], effectiveRoleScopes: [{ role: "Receptionist", locationId: "location-b" }, { role: "Provider", locationId: "location-a" }] } },
  ]) {
    const { service, writes } = completionFixture(options);
    await assert.rejects(service.updateStatus("visit-a", { status: "Completed" }), ForbiddenException);
    assert.equal(writes.length, 0);
  }
  const unlocated = completionFixture({ session: { ...actor, effectiveRoleScopes: [{ role: "Receptionist", locationId: "location-a" }] } });
  unlocated.appointment.locationId = null as never;
  await assert.rejects(unlocated.service.updateStatus("visit-a", { status: "Completed" }), ForbiddenException);
});
