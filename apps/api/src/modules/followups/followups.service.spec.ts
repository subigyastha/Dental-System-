import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";

import { FollowupsService } from "./followups.service";
import { FollowupQueueDto, type LogFollowupDto } from "./followup-work.dto";
import { validate } from "class-validator";

const actor = { id: "staff-a", organizationId: "clinic-a", role: "Receptionist", effectiveRoles: ["Receptionist"] };
const visit = { id: "visit-a", startsAt: new Date("2026-02-28T09:00:00+05:45"), locationId: "location-a", providerId: "provider-a" };
const task = {
  id: "recall-a", customerId: "client-a", organizationId: "clinic-a", appointmentId: visit.id,
  type: "Recall", status: "Open", dueAt: new Date("2026-08-27T18:15:00Z"),
  nextAction: "Call the client", updatedAt: new Date("2026-02-28T09:00:00Z"),
  ownerId: "provider-a", appointment: { locationId: visit.locationId, providerId: visit.providerId },
};

function workFixture(options: { session?: unknown; missing?: boolean; archived?: boolean; conflict?: boolean; failAudit?: boolean; done?: boolean; recall?: boolean } = {}) {
  let current = { ...task, status: options.done ? "Done" : "Open", type: options.recall ? "Recall" : "TreatmentContinuation",
    summary: "Post-visit follow-up", customer: { fullName: "Test client", phone: "9800000000", patientCode: "CL-1", archivedAt: options.archived ? new Date() : null, mergedIntoCustomerId: null },
    appointment: { ...visit, customProcedureName: "Extraction", provider: { displayName: "Dr Test" } },
  };
  const attempts: Array<{ newValue: Record<string, unknown>; actorId: string; [key: string]: unknown }> = [];
  const nextTasks: unknown[] = [];
  const contacts: Array<Record<string, unknown>> = [];
  let locked = false;
  const model = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.organizationId, actor.organizationId);
      if (options.missing) return null;
      if (where.type === "Recall") return null;
      return { ...current };
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<typeof current> }) => {
      assert.ok(locked); assert.equal(where.organizationId, actor.organizationId);
      if (options.conflict) return { count: 0 };
      current = { ...current, ...data }; return { count: 1 };
    },
    create: async ({ data }: { data: unknown }) => { nextTasks.push(data); return { id: "next-recall" }; },
  };
  const tx = { followUpTask: model,
    communicationLog: { create: async ({ data }: { data: Record<string, unknown> }) => { assert.ok(locked); contacts.push(data); return { id: "contact" }; } },
    $queryRaw: async (sql: { strings: string[]; values: unknown[] }) => { assert.match(sql.strings.join(""), /Customer.*FOR UPDATE/); assert.ok(sql.values.includes(actor.organizationId)); locked = true; return []; },
    auditLog: {
      findFirst: async ({ where }: { where: { newValue: { equals: string } } }) => attempts.find(row => row.newValue.requestId === where.newValue.equals) ?? null,
      create: async ({ data }: { data: typeof attempts[number] }) => { if (options.failAudit) throw new Error("Audit failed"); attempts.push(data); },
    },
  };
  const service = new FollowupsService({ followUpTask: model, $transaction: async (run: (value: typeof tx) => Promise<unknown>) => {
    const before = current, count = attempts.length, nextCount = nextTasks.length, contactCount = contacts.length;
    try { return await run(tx); } catch (error) { current = before; attempts.splice(count); nextTasks.splice(nextCount); contacts.splice(contactCount); throw error; }
  } } as never, { requireSession: async () => options.session ?? actor } as never);
  const dto = (changes: Partial<LogFollowupDto> = {}): LogFollowupDto => ({ response: "reached", requestId: "request-a", expectedUpdatedAtIso: current.updatedAt.toISOString(), ...changes });
  return { service, dto, attempts, nextTasks, contacts, current: () => current };
}

test("quick follow-up responses retain notes and actor, finish only the case task, and safely replay", async () => {
  const f = workFixture(); const dto = f.dto({ note: "  Doing well  " });
  await f.service.log(task.id, dto);
  assert.equal(f.current().status, "Done");
  assert.equal(f.attempts[0].newValue.note, "Doing well");
  assert.equal(f.attempts[0].actorId, actor.id);
  assert.equal(f.nextTasks.length, 0);
  await f.service.log(task.id, dto);
  assert.equal(f.attempts.length, 1);
  assert.equal(f.contacts.length, 1); assert.equal(f.contacts[0].channel, "unknown");
  assert.equal(f.contacts[0].responseText, undefined); assert.deepEqual(f.contacts[0].metadata, { legacyResponse: "reached", staffNote: "Doing well" });
  await assert.rejects(f.service.log(task.id, { ...dto, note: "Changed" }), ConflictException);
  await assert.rejects(f.service.log(task.id, { ...dto, requestId: "other-request" }), ConflictException);
});

test("no-answer and agreed-contact responses wait until a future time, including today", async () => {
  for (const response of ["no_answer", "contact_later", "reschedule"] as const) {
    const f = workFixture();
    const due = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await f.service.log(task.id, f.dto({ response, nextContactAtIso: due }));
    assert.equal(f.current().status, "Waiting");
    assert.equal(f.current().dueAt.toISOString(), due);
    assert.equal(f.attempts[0].newValue.nextContactAtIso, due);
    assert.ok(f.current().updatedAt > task.updatedAt);
  }
});

test("quick outcomes reject missing or past retry times, missing reasons, and stale writes", async () => {
  for (const changes of [
    { response: "no_answer" as const }, { response: "contact_later" as const, nextContactAtIso: "2020-01-01T00:00:00Z" },
    { response: "provider_attention" as const, note: " " }, { response: "not_needed" as const },
    { nextRecallAtIso: "2030-01-01T00:00:00Z" },
  ]) {
    const f = workFixture(); await assert.rejects(f.service.log(task.id, f.dto(changes)), BadRequestException); assert.equal(f.attempts.length, 0);
  }
  const stale = workFixture(); await assert.rejects(stale.service.log(task.id, stale.dto({ expectedUpdatedAtIso: "2020-01-01T00:00:00Z" })), ConflictException);
  const concurrent = workFixture({ conflict: true }); await assert.rejects(concurrent.service.log(task.id, concurrent.dto()), ConflictException);
  assert.equal(concurrent.attempts.length, 0);
});

test("booking and provider outcomes remain actionable without claiming a notification or a booking", async () => {
  const booking = workFixture(); await booking.service.log(task.id, booking.dto({ response: "appointment_needed" }));
  assert.equal(booking.current().status, "Open"); assert.ok(booking.current().dueAt <= new Date());
  const provider = workFixture(); await provider.service.log(task.id, provider.dto({ response: "provider_attention", note: "Client asks to speak with provider" }));
  assert.equal(provider.current().status, "Blocked"); assert.match(provider.current().nextAction, /Dr Test.*Client asks/);
  assert.equal(provider.nextTasks.length, 0);
});

test("quick logging respects tenant, location, provider, archive and finished-task boundaries", async () => {
  const missing = workFixture({ missing: true }); await assert.rejects(missing.service.log(task.id, missing.dto()), NotFoundException);
  for (const session of [
    { ...actor, effectiveRoleScopes: [{ role: "Receptionist", locationId: "location-b" }] },
    { ...actor, role: "Provider", effectiveRoles: ["Provider"], providerId: "provider-b" },
    { ...actor, role: "Finance", effectiveRoles: ["Finance"] },
  ]) { const f = workFixture({ session }); await assert.rejects(f.service.log(task.id, f.dto()), ForbiddenException); assert.equal(f.attempts.length, 0); }
  const archived = workFixture({ archived: true }); await assert.rejects(archived.service.log(task.id, archived.dto()), BadRequestException);
  const done = workFixture({ done: true }); await assert.rejects(done.service.log(task.id, done.dto()), ConflictException);
});

test("audit failure rolls back a response; recall completion never creates another reminder", async () => {
  const failed = workFixture({ failAudit: true }); await assert.rejects(failed.service.log(task.id, failed.dto()), /Audit failed/);
  assert.equal(failed.current().status, "Open"); assert.equal(failed.attempts.length, 0);
  const recall = workFixture({ recall: true }); const dto = recall.dto(); await recall.service.log(task.id, dto); await recall.service.log(task.id, dto);
  assert.equal(recall.nextTasks.length, 0); assert.equal(recall.attempts.length, 1);
});

test("queue reads apply tenant/location/active-client scope and exact-time attention boundaries", async () => {
  const queries: Array<Record<string, unknown>> = [];
  const session = { ...actor, effectiveRoleScopes: [{ role: "Receptionist", locationId: "location-a" }] };
  const service = new FollowupsService({ followUpTask: {
    findMany: async (args: Record<string, unknown>) => { queries.push(args); return []; },
    count: async (args: Record<string, unknown>) => { queries.push(args); return 0; },
    groupBy: async (args: Record<string, unknown>) => { queries.push(args); return []; },
  } } as never, { requireSession: async () => session } as never);
  const result = await service.list({ view: "attention", query: "Test" });
  assert.deepEqual(result.counts, { attention: 0, upcoming: 0, done: 0, today: 0, overdue: 0, future: 0 });
  const conditions = (queries[0].where as { AND: Array<Record<string, unknown>> }).AND;
  assert.equal(conditions[0].organizationId, actor.organizationId);
  assert.deepEqual(conditions[0].appointment, { is: { locationId: { in: ["location-a"] } } });
  assert.deepEqual(conditions[0].customer, { archivedAt: null, mergedIntoCustomerId: null });
  const due = conditions[1].dueAt as { lte: Date };
  const upcoming = ((queries[2].where as { AND: Array<Record<string, unknown>> }).AND[1].dueAt as { gt: Date });
  assert.equal(upcoming.gt, due.lte);
  assert.equal(queries[0].take, 26);
});

test("table and board filters apply before pagination with stable server sorting and scoped totals", async () => {
  const queries: Array<Record<string, unknown>> = [];
  const session = { ...actor, effectiveRoleScopes: [{ role: "Receptionist", locationId: "location-a" }] };
  const service = new FollowupsService({ followUpTask: {
    findMany: async (args: Record<string, unknown>) => { queries.push(args); return []; },
    count: async (args: Record<string, unknown>) => { queries.push(args); return 0; },
    groupBy: async (args: Record<string, unknown>) => { queries.push(args); return []; },
  } } as never, { requireSession: async () => session } as never);
  for (const [sort, order] of [["client", { customer: { fullName: "desc" } }], ["due", { dueAt: "desc" }], ["status", { status: "desc" }], ["updated", { updatedAt: "desc" }]] as const) {
    queries.length = 0;
    const result = await service.list({ view: "all", status: "Done", period: "today", sort, direction: "desc", query: "Client" });
    assert.deepEqual(queries[0].orderBy, [order, { id: "desc" }]); assert.equal(queries[0].take, 26);
    const base = (queries[0].where as { AND: Array<Record<string, unknown>> }).AND[0];
    assert.equal(base.organizationId, actor.organizationId); assert.equal(base.status, "Done");
    assert.deepEqual(base.appointment, { is: { locationId: { in: ["location-a"] } } });
    assert.equal(Object.keys((queries[0].where as { AND: Array<Record<string, unknown>> }).AND[1]).length, 0);
    const due = base.dueAt as { gte: Date; lt: Date }; assert.equal(due.lt.getTime() - due.gte.getTime(), 86400000);
    assert.ok(base.OR); assert.equal(result.total, 0); assert.deepEqual(result.statusCounts, { Open: 0, InProgress: 0, Waiting: 0, Blocked: 0, Done: 0 });
    for (const countQuery of queries.slice(7)) assert.match(JSON.stringify(countQuery.where), /clinic-a/);
  }
});

test("queue groups status totals in one scoped query and fills missing statuses", async () => {
  let counts = 0;
  let groups = 0;
  let groupedWhere: unknown;
  let listedWhere: unknown;
  const service = new FollowupsService({ followUpTask: {
    findMany: async (args: { where: unknown }) => { listedWhere = args.where; return []; },
    count: async () => { counts++; return 0; },
    groupBy: async (args: { where: unknown; by: string[] }) => {
      groups++; groupedWhere = args.where; assert.deepEqual(args.by, ["status"]);
      return [{ status: "Open", _count: { _all: 7 } }, { status: "Done", _count: { _all: 2 } }];
    },
  } } as never, { requireSession: async () => actor } as never);
  const result = await service.list({ view: "all", query: "Test" });
  assert.equal(counts, 6); assert.equal(groups, 1);
  assert.deepEqual(groupedWhere, listedWhere);
  assert.match(JSON.stringify(groupedWhere), /clinic-a/);
  assert.deepEqual(result.statusCounts, { Open: 7, InProgress: 0, Waiting: 0, Blocked: 0, Done: 2 });
  assert.equal(result.total, 9);
});

test("sorting and filter DTO rejects unsupported fields and allows known board states", async () => {
  for (const field of ["sort", "direction", "period", "status", "view"]) {
    const dto = Object.assign(new FollowupQueueDto(), { [field]: "unsupported" });
    assert.ok((await validate(dto)).some(error => error.property === field));
  }
  assert.equal((await validate(Object.assign(new FollowupQueueDto(), { view: "all", status: "InProgress", sort: "client", direction: "desc", period: "future" }))).length, 0);
});

test("pagination cursor outside current filters fails without fetching another page", async () => {
  let read = false;
  const service = new FollowupsService({ followUpTask: {
    findFirst: async ({ where }: { where: unknown }) => { assert.match(JSON.stringify(where), /clinic-a/); assert.match(JSON.stringify(where), /Blocked/); return null; },
    findMany: async () => { read = true; return []; },
  } } as never, { requireSession: async () => actor } as never);
  await assert.rejects(service.list({ view: "all", status: "Blocked", cursor: "other-task" }), ConflictException);
  assert.equal(read, false);
});

function fixture(options: { task?: typeof task | null; session?: unknown; claimCount?: number; next?: unknown; failCreate?: boolean; visit?: typeof visit | null } = {}) {
  const writes: Array<{ kind: string; data: Record<string, unknown> }> = [];
  const queries: Array<{ kind: string; args: Record<string, unknown> }> = [];
  let completed = options.task?.status === "Done";
  let locked = false;
  const tx = {
    $queryRaw: async (sql: { strings: string[]; values: unknown[] }) => {
      assert.match(sql.strings.join(""), /Customer.*organizationId.*FOR UPDATE/);
      assert.ok(sql.values.includes(actor.organizationId));
      locked = true;
      return [{ id: "client-a" }];
    },
    customer: { findFirst: async () => ({ id: "client-a" }) },
    appointment: { findFirst: async (args: Record<string, unknown>) => {
      assert.equal(locked, true);
      queries.push({ kind: "appointment", args });
      return options.visit === null ? null : options.visit ?? visit;
    } },
    followUpTask: {
      findFirst: async (args: Record<string, unknown>) => {
        assert.equal(locked, true);
        queries.push({ kind: "task", args });
        const where = args.where as Record<string, unknown>;
        return where.status === "Done" ? (completed ? { id: task.id } : null) : options.next ?? null;
      },
      updateMany: async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
        assert.equal(locked, true);
        assert.equal(where.organizationId, actor.organizationId);
        assert.ok(where.updatedAt);
        if (options.claimCount === 0) return { count: 0 };
        writes.push({ kind: "update", data }); completed = data.status === "Done";
        return { count: 1 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.failCreate) throw new Error("Database write failed");
        writes.push({ kind: "create", data });
        return { id: "next-a", ...data };
      },
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ kind: "audit", data }); } },
  };
  const service = new FollowupsService({
    followUpTask: { findFirst: async (args: Record<string, unknown>) => {
      queries.push({ kind: "lookup", args }); return options.task === null ? null : options.task ?? task;
    } },
    $transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => {
      const count = writes.length;
      try { return await run(tx); } catch (error) { writes.splice(count); throw error; }
    },
  } as never, { requireSession: async () => options.session ?? actor } as never);
  return { service, writes, queries };
}

test("recall completion records the outcome without a next recall, including on retry", async () => {
  const f = fixture(); await f.service.update(task.id, { status: "Done", outcome: "Client contacted" });
  await f.service.update(task.id, { status: "Done", outcome: "Client contacted" });
  assert.deepEqual(f.writes.map(row => row.kind), ["update", "audit"]);
});

test("done retry and completed-task reopen preserve the recorded outcome", async () => {
  const { service, writes } = fixture({ task: { ...task, status: "Done" } });
  assert.deepEqual(await service.update(task.id, { status: "Done", outcome: "Retry" }), { ok: true });
  await assert.rejects(service.update(task.id, { status: "Open", outcome: "Retry", dueAtIso: "2030-01-01T00:00:00+05:45" }), BadRequestException);
  assert.equal(writes.length, 0);
});

test("staff can adjust a recall date and next action without completing it", async () => {
  const { service, writes } = fixture();
  await service.update(task.id, { status: "Open", dueAtIso: "2026-12-01T00:00:00+05:45", outcome: "Call on the agreed date" });
  assert.equal(writes[0].data.status, "Open");
  assert.equal((writes[0].data.dueAt as Date).toISOString(), "2026-11-30T18:15:00.000Z");
  assert.equal(writes.some((write) => write.kind === "create"), false);
});

test("a case-specific follow-up closes without creating a routine recall", async () => {
  const { service, writes } = fixture({ task: { ...task, type: "TreatmentContinuation" } });
  await service.update(task.id, { status: "Done", outcome: "Treatment arranged" });
  assert.equal(writes.some((write) => write.kind === "create"), false);
});

test("invalid outcomes and past next recalls fail before any write", async () => {
  const { service, writes } = fixture();
  await assert.rejects(service.update(task.id, { status: "Done", outcome: "  " }), BadRequestException);
  await assert.rejects(service.update(task.id, { status: "Open", outcome: "Call" }), BadRequestException);
  assert.equal(writes.length, 0);
});

test("a stale follow-up update conflicts without recording an outcome or creating a recall", async () => {
  const { service, writes } = fixture({ claimCount: 0 });
  await assert.rejects(service.update(task.id, { status: "Done", outcome: "Done" }), ConflictException);
  assert.equal(writes.length, 0);
});

test("follow-up writes require the tenant, location and assigned provider authority", async () => {
  const missing = fixture({ task: null });
  await assert.rejects(missing.service.update(task.id, { status: "Done", outcome: "Done" }), NotFoundException);
  assert.deepEqual(missing.queries[0].args.where, { id: task.id, organizationId: actor.organizationId });
  for (const session of [
    { ...actor, effectiveRoleScopes: [{ role: "Receptionist", locationId: "location-b" }] },
    { ...actor, role: "Provider", providerId: "provider-b", effectiveRoles: ["Provider"] },
  ]) {
    const restricted = fixture({ session });
    await assert.rejects(restricted.service.update(task.id, { status: "Done", outcome: "Done" }), ForbiddenException);
    assert.equal(restricted.writes.length, 0);
  }
  const unlinked = fixture({ task: { ...task, appointment: null, ownerId: null } as never, session: { ...actor, effectiveRoleScopes: [{ role: "Receptionist", locationId: "location-a" }] } });
  await assert.rejects(unlinked.service.update(task.id, { status: "Done", outcome: "Done" }), ForbiddenException);
});

const review = { appointmentId: visit.id, dueDate: "2026-10-09", summary: " Extraction review ", nextAction: " Arrange review " };

test("procedure review creates an assigned case task and audit without changing routine recalls", async () => {
  const { service, writes, queries } = fixture();
  assert.deepEqual(await service.createProcedureReview("client-a", review), { id: "next-a" });
  assert.deepEqual(queries.find((query) => query.kind === "appointment")!.args.where, { id: visit.id, customerId: "client-a", organizationId: actor.organizationId, status: "Completed" });
  assert.deepEqual(writes.map((write) => write.kind), ["create", "audit"]);
  assert.equal(writes[0].data.type, "TreatmentContinuation");
  assert.equal(writes[0].data.ownerId, visit.providerId);
  assert.equal(writes[0].data.summary, "Extraction review");
  assert.equal((writes[0].data.dueAt as Date).toISOString(), "2026-10-08T18:15:00.000Z");
  assert.equal(writes[1].data.action, "procedure_review_created");
});

test("procedure review retry preserves the active task and changed requests conflict", async () => {
  const existing = { id: "review-a", dueAt: new Date("2026-10-09T00:00:00+05:45"), summary: review.summary.trim(), nextAction: review.nextAction.trim() };
  const { service, writes } = fixture({ next: existing });
  assert.deepEqual(await service.createProcedureReview("client-a", review), { id: existing.id });
  await assert.rejects(service.createProcedureReview("client-a", { ...review, dueDate: "2026-10-10" }), ConflictException);
  assert.equal(writes.length, 0);
});

test("procedure review rejects invalid dates, missing visits, and unauthorized locations/providers", async () => {
  const invalid = fixture();
  for (const changes of [{ dueDate: "2026-02-30" }, { dueDate: "2026-02-27" }, { summary: " " }, { nextAction: " " }]) {
    await assert.rejects(invalid.service.createProcedureReview("client-a", { ...review, ...changes }), BadRequestException);
  }
  assert.equal(invalid.writes.length, 0);
  const noVisit = fixture({ visit: null });
  await assert.rejects(noVisit.service.createProcedureReview("client-a", review), NotFoundException);
  for (const session of [
    { ...actor, effectiveRoleScopes: [{ role: "Receptionist", locationId: "location-b" }] },
    { ...actor, role: "Provider", providerId: "provider-b", effectiveRoles: ["Provider"] },
  ]) {
    const restricted = fixture({ session });
    await assert.rejects(restricted.service.createProcedureReview("client-a", review), ForbiddenException);
    assert.equal(restricted.writes.length, 0);
  }
});

test("procedure review task failure rolls back its transaction", async () => {
  const failed = fixture({ failCreate: true });
  await assert.rejects(failed.service.createProcedureReview("client-a", review), /Database write failed/);
  assert.equal(failed.writes.length, 0);
});
