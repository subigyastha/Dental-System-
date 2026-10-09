import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";

import { FollowupsService } from "./followups.service";
import { defaultRecallDate, recurringRecallAction } from "./recall-date";

const actor = { id: "staff-a", organizationId: "clinic-a", role: "Receptionist", effectiveRoles: ["Receptionist"] };
const visit = { id: "visit-a", startsAt: new Date("2026-02-28T09:00:00+05:45"), locationId: "location-a", providerId: "provider-a" };
const task = {
  id: "recall-a", customerId: "client-a", organizationId: "clinic-a", appointmentId: visit.id,
  type: "Recall", status: "Open", dueAt: new Date("2026-08-27T18:15:00Z"),
  nextAction: "Call the client", updatedAt: new Date("2026-02-28T09:00:00Z"),
  ownerId: "provider-a", appointment: { locationId: visit.locationId, providerId: visit.providerId },
};

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

test("recall completion atomically records the outcome and creates one next routine recall", async () => {
  const { service, writes } = fixture();
  await service.update(task.id, { status: "Done", outcome: "  Client contacted  " });
  assert.deepEqual(writes.map((write) => write.kind), ["update", "audit", "create"]);
  assert.equal(writes[0].data.nextAction, "Client contacted");
  assert.equal((writes[0].data.dueAt as Date).toISOString(), task.dueAt.toISOString());
  assert.equal(writes[2].data.type, "Recall");
  assert.equal((writes[2].data.dueAt as Date).toISOString(), defaultRecallDate(new Date()).toISOString());
  assert.equal(writes[2].data.nextAction, recurringRecallAction);
  // A retry which originally read an open task sees the locked, completed row.
  await service.update(task.id, { status: "Done", outcome: "Client contacted" });
  assert.equal(writes.filter((write) => write.kind === "create").length, 1);
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

test("recall completion accepts an agreed future next recall and preserves an existing active recall", async () => {
  const explicit = fixture();
  await explicit.service.update(task.id, { status: "Done", outcome: "Done", dueAtIso: "2030-01-01T00:00:00+05:45" });
  assert.equal((explicit.writes.find((write) => write.kind === "create")!.data.dueAt as Date).toISOString(), "2029-12-31T18:15:00.000Z");
  const existing = fixture({ next: { id: "another-recall" } });
  await existing.service.update(task.id, { status: "Done", outcome: "Done" });
  assert.equal(existing.writes.some((write) => write.kind === "create"), false);
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
  await assert.rejects(service.update(task.id, { status: "Done", outcome: "Call", dueAtIso: "2020-01-01" }), BadRequestException);
  assert.equal(writes.length, 0);
});

test("a stale follow-up update conflicts without recording an outcome or creating a recall", async () => {
  const { service, writes } = fixture({ claimCount: 0 });
  await assert.rejects(service.update(task.id, { status: "Done", outcome: "Done" }), ConflictException);
  assert.equal(writes.length, 0);
});

test("a failed next-recall write rolls back the outcome and audit", async () => {
  const { service, writes } = fixture({ failCreate: true });
  await assert.rejects(service.update(task.id, { status: "Done", outcome: "Done" }), /Database write failed/);
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

test("historical recall review locks the client and uses the latest completed tenant visit", async () => {
  const { service, writes, queries } = fixture();
  assert.deepEqual(await service.createRecall("client-a"), { id: "next-a" });
  assert.deepEqual(queries.find((query) => query.kind === "appointment")!.args.where, { customerId: "client-a", organizationId: actor.organizationId, status: "Completed" });
  assert.equal((writes[0].data.dueAt as Date).toISOString(), defaultRecallDate(visit.startsAt).toISOString());
  assert.equal(writes[1].data.action, "recall_created");
});

test("historical recall review preserves an existing active recall and requires a completed visit", async () => {
  const existing = fixture({ next: { id: task.id, ownerId: task.ownerId, appointment: task.appointment } });
  assert.deepEqual(await existing.service.createRecall("client-a"), { id: task.id });
  assert.equal(existing.writes.length, 0);
  const noVisit = fixture({ visit: null });
  await assert.rejects(noVisit.service.createRecall("client-a"), NotFoundException);
  assert.equal(noVisit.writes.length, 0);
});
