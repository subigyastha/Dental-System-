import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { StaffFollowupsService } from "./staff-followups.service";
import { type StaffFollowupDto } from "./staff-followup.dto";

const actor = { id: "staff", organizationId: "clinic", role: "Receptionist", effectiveRoles: ["Receptionist"] };
const visit = { id: "visit", startsAt: new Date(), locationId: "location", providerId: "provider", customProcedureName: "Treatment", services: [], provider: { displayName: "Doctor" } };
function fixture(options: { actor?: unknown; missing?: boolean; failAudit?: boolean; conflict?: boolean; noVisit?: boolean } = {}) {
  const audits: Array<{ entityType: string; action: string; newValue: Record<string, unknown> }> = [];
  const creates: unknown[] = []; const updates: Array<Record<string, unknown>> = [];
  const contacts: Array<Record<string, unknown>> = [];
  const task = { id: "task", status: "Open", appointmentId: visit.id, updatedAt: new Date("2026-10-01T00:00:00Z"), ownerId: "provider", nextAction: "Doctor requested a check-in", appointment: visit };
  let locked = false;
  const tx = { $queryRaw: async () => { locked = true; },
    customer: { findFirst: async ({ where }: { where: Record<string, unknown> }) => { assert.equal(where.organizationId, "clinic"); assert.equal(where.archivedAt, null); assert.equal(where.mergedIntoCustomerId, null); return options.missing ? null : { id: "client" }; } },
    appointment: { findFirst: async () => options.noVisit ? null : visit },
    communicationLog: { create: async ({ data }: { data: Record<string, unknown> }) => { assert.ok(locked); contacts.push(data); return { id: "contact" }; } },
    followUpTask: { findFirst: async () => task, create: async ({ data }: { data: unknown }) => { assert.ok(locked); creates.push(data); return { id: "created" }; },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { assert.ok(locked); updates.push(data); return { count: options.conflict ? 0 : 1 }; } },
    auditLog: { findFirst: async ({ where }: { where: { newValue: { equals: string } } }) => audits.find(row => row.entityType === "client_contact" && row.newValue.requestId === where.newValue.equals) ?? null,
      create: async ({ data }: { data: typeof audits[number] }) => { if (options.failAudit) throw new Error("Audit failed"); audits.push(data); } },
  };
  const service = new StaffFollowupsService({ $transaction: async (run: (value: typeof tx) => Promise<unknown>) => {
    const counts = [audits.length, creates.length, updates.length, contacts.length];
    try { return await run(tx); } catch (error) { audits.splice(counts[0]); creates.splice(counts[1]); updates.splice(counts[2]); contacts.splice(counts[3]); throw error; }
  } } as never, { requireSession: async () => options.actor ?? actor } as never);
  const dto: StaffFollowupDto = { action: "log", requestId: "request", appointmentId: visit.id, result: "reached" };
  return { service, dto, audits, creates, updates, contacts, task };
}

test("a contact log needs no task, creates no reminder, and replays without duplication", async () => {
  const f = fixture(); await f.service.save("client", f.dto); await f.service.save("client", f.dto);
  assert.equal(f.creates.length, 0); assert.equal(f.updates.length, 0); assert.equal(f.audits.length, 1);
  assert.equal(f.audits[0].action, "contact_logged");
  assert.equal(f.contacts.length, 1); assert.equal(f.contacts[0].channel, "unknown"); assert.equal(f.contacts[0].source, "manual");
  await assert.rejects(f.service.save("client", { ...f.dto, result: "no_answer" }), ConflictException);
});

test("staff scheduling records the chosen date and instruction without counting as contact", async () => {
  const f = fixture(); const dto: StaffFollowupDto = { action: "schedule", appointmentId: visit.id, requestId: "schedule", dueAtIso: "2099-01-01T00:00:00+05:45", dateOnly: true, reason: "Doctor requested check-in" };
  await f.service.save("client", dto); await f.service.save("client", dto);
  assert.equal(f.creates.length, 1); assert.equal(f.audits.length, 1); assert.equal(f.audits[0].action, "followup_scheduled");
  assert.equal((f.creates[0] as { nextAction: string }).nextAction, dto.reason);
  assert.equal((f.creates[0] as { dateOnly: boolean }).dateOnly, true); assert.equal(f.contacts.length, 0);
});

test("logging no answer keeps a staff reminder unchanged; reached completes it without recurrence", async () => {
  for (const result of ["no_answer", "reached"] as const) {
    const f = fixture(); await f.service.save("client", { ...f.dto, result, taskId: f.task.id, expectedUpdatedAtIso: f.task.updatedAt.toISOString() });
    assert.equal(f.updates[0].status, result === "reached" ? "Done" : "Open");
    assert.equal(f.updates[0].dueAt, undefined); assert.equal(f.updates[0].nextAction, undefined);
    assert.equal(f.creates.length, 0); assert.equal(f.audits.length, 2);
  }
});

test("missing clients, unauthorized providers, stale reminders and failed audits leave no changes", async () => {
  const missing = fixture({ missing: true }); await assert.rejects(missing.service.save("client", missing.dto), NotFoundException);
  const provider = fixture({ actor: { ...actor, role: "Provider", effectiveRoles: ["Provider"], providerId: "other" } });
  await assert.rejects(provider.service.save("client", provider.dto), ForbiddenException);
  const location = fixture({ actor: { ...actor, effectiveRoleScopes: [{ role: "Receptionist", locationId: "other-location" }] } });
  await assert.rejects(location.service.save("client", location.dto), ForbiddenException);
  const stale = fixture(); await assert.rejects(stale.service.save("client", { ...stale.dto, taskId: "task", expectedUpdatedAtIso: "2020-01-01T00:00:00Z" }), ConflictException);
  const failure = fixture({ failAudit: true }); await assert.rejects(failure.service.save("client", { ...failure.dto, taskId: "task", expectedUpdatedAtIso: failure.task.updatedAt.toISOString() }), /Audit failed/);
  for (const f of [missing, provider, location, stale, failure]) { assert.equal(f.creates.length, 0); assert.equal(f.updates.length, 0); assert.equal(f.audits.length, 0); assert.equal(f.contacts.length, 0); }
});

test("contact method, client response and actual time persist separately from recording time", async () => {
  for (const channel of ["call", "whatsapp", "sms", "email", "in_person", "other"] as const) {
    const f = fixture(); const occurredAtIso = "2026-01-01T12:00:00+05:45";
    const dto = { ...f.dto, channel, direction: "inbound" as const, occurredAtIso, responseText: " Feeling better " };
    await f.service.save("client", dto); await f.service.save("client", dto);
    assert.equal(f.contacts.length, 1); const row = f.contacts[0];
    assert.equal(row.channel, channel); assert.equal(row.source, "manual"); assert.equal(row.direction, "inbound");
    assert.equal(row.responseText, "Feeling better"); assert.equal(row.recordedByUserId, actor.id);
    assert.equal((row.occurredAt as Date).toISOString(), new Date(occurredAtIso).toISOString());
    assert.ok((row.recordedAt as Date) > (row.occurredAt as Date));
    assert.equal(row.purpose, "follow_up"); assert.equal(row.followUpTaskId, null);
    await assert.rejects(f.service.save("client", { ...dto, responseText: "Different response" }), ConflictException);
    await assert.rejects(f.service.save("client", { ...dto, channel: "unknown" }), ConflictException);
  }
});

test("response and method validation rejects contradictory contact records without writes", async () => {
  for (const changes of [{ channel: "unsupported" }, { occurredAtIso: "2099-01-01T00:00:00Z" }, { occurredAtIso: "invalid" },
    { occurredAtIso: "2026-01-01" }, { occurredAtIso: "2026-01-01T12:00:00" },
    { result: "no_answer", responseText: "A client response" }, { responseText: "x".repeat(2001) }, { direction: "invalid" }, { dateOnly: false },
    { action: "schedule", result: undefined, dueAtIso: "2099-01-01T00:00:00+05:45", responseText: "Not a contact" } ] as Array<Partial<StaffFollowupDto>>) {
    const f = fixture(); await assert.rejects(f.service.save("client", { ...f.dto, ...changes }), BadRequestException);
    assert.equal(f.contacts.length, 0); assert.equal(f.creates.length, 0);
  }
});

test("past dates, missing results, implied next contact and invalid date-only times are rejected", async () => {
  const f = fixture();
  for (const changes of [{ result: undefined }, { dueAtIso: "2099-01-01T00:00:00Z" }, { action: "schedule", result: undefined, dueAtIso: "2020-01-01T00:00:00+05:45", dateOnly: true }, { action: "schedule", result: undefined, dueAtIso: "2099-01-01T12:00:00+05:45", dateOnly: true }] as Array<Partial<StaffFollowupDto>>) {
    await assert.rejects(f.service.save("client", { ...f.dto, ...changes }), BadRequestException);
  }
  assert.equal(f.creates.length, 0); assert.equal(f.audits.length, 0);
});

test("client suggestions are bounded, active, tenant/location scoped reads and exclude future visit dates", async () => {
  const queries: Array<Record<string, unknown>> = [];
  const session = { ...actor, effectiveRoleScopes: [{ role: "Receptionist", locationId: "location" }] };
  const service = new StaffFollowupsService({
    customer: { findMany: async (args: Record<string, unknown>) => { queries.push(args); return [{ id: "client", fullName: "Client", phone: "9800000000", patientCode: "CL-1", appointments: [visit], followUpTasks: [] }]; } },
    appointment: { findMany: async () => [] },
    followUpTask: { findMany: async () => [] },
    $queryRaw: async (sql: { strings: string[]; values: unknown[] }) => {
      assert.match(sql.strings.join(""), /contact_logged/); assert.match(sql.strings.join(""), /a\."locationId" IN/);
      assert.ok(sql.values.includes("clinic")); assert.ok(sql.values.includes("location")); return [];
    },
  } as never, { requireSession: async () => session } as never);
  const result = await service.clients({ view: "recent", query: "Client" });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].lastAttemptAtIso, null); assert.equal(result.items[0].nextContactAtIso, null);
  const args = queries[0] as { take: number; where: { organizationId: string; archivedAt: null; mergedIntoCustomerId: null; appointments: { some: { locationId: unknown; startsAt: { lte: Date } } } };
    select: { appointments: { where: { startsAt: { lte: Date } } } } };
  assert.equal(args.take, 26); assert.equal(args.where.organizationId, "clinic"); assert.equal(args.where.archivedAt, null); assert.equal(args.where.mergedIntoCustomerId, null);
  assert.deepEqual(args.where.appointments.some.locationId, { in: ["location"] }); assert.ok(args.where.appointments.some.startsAt.lte);
  assert.ok(args.select.appointments.where.startsAt.lte);
});
