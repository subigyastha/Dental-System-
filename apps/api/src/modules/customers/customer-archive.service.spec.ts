import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenException, BadRequestException } from "@nestjs/common";

import { CustomerArchiveService } from "./customer-archive.service";

const owner = { id: "owner-a", organizationId: "clinic-a", name: "Owner", email: "owner@example.test", role: "Owner" };
const admin = { ...owner, id: "admin-a", role: "Admin" };

function archivePrisma(
  customer: Record<string, unknown>,
  options: { mergeSecondaries?: number } = {},
) {
  const auditEvents: Array<Record<string, unknown>> = [];
  let deleted = false;
  const prisma = {
    customer: {
      findFirst: async () => customer,
      count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        where && "mergedIntoCustomerId" in where ? options.mergeSecondaries ?? 0 : 0,
      delete: async () => { deleted = true; return customer; },
    },
    appointment: { count: async () => 0 },
    appointmentSession: { count: async () => 0 },
    followUpTask: { count: async () => 0 },
    communicationLog: { count: async () => 0 },
    invoice: { count: async () => 0 },
    payment: { count: async () => 0 },
    patientDentalChart: { count: async () => 0 },
    dentalChartRevision: { count: async () => 0 },
    clientMerge: { count: async () => 0 },
    clientAlias: { count: async () => 0 },
    $transaction: async (callback: (tx: unknown) => unknown) => callback({
      customer: {
        updateMany: async () => ({ count: 0 }),
        delete: async () => { deleted = true; return customer; },
      },
      clientMerge: { deleteMany: async () => ({ count: 0 }) },
      clientAlias: { deleteMany: async () => ({ count: 0 }) },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { auditEvents.push(data); return { id: "audit" }; } },
    }),
  } as never;
  return { prisma, auditEvents, wasDeleted: () => deleted };
}

test("Admin cannot permanently delete an archived client", async () => {
  const { prisma } = archivePrisma({ id: "client-a" });
  const service = new CustomerArchiveService(prisma, { requireSession: async () => admin } as never);
  await assert.rejects(service.purge("client-a", "client-a", "Requested", admin), ForbiddenException);
});

test("purge requires a typed target confirmation before it reads the client", async () => {
  const { prisma } = archivePrisma({ id: "client-a" });
  const service = new CustomerArchiveService(prisma, { requireSession: async () => owner } as never);
  await assert.rejects(service.purge("client-a", "different-client", "Requested", owner), BadRequestException);
});

test("legal hold blocks Owner permanent deletion", async () => {
  const { prisma, wasDeleted } = archivePrisma({
    id: "client-a", organizationId: "clinic-a", archivedAt: new Date(), retentionUntil: null,
    legalHoldAt: new Date(), legalHoldReason: "Dispute",
  });
  const service = new CustomerArchiveService(prisma, { requireSession: async () => owner } as never);
  await assert.rejects(service.purge("client-a", "client-a", "Requested", owner), ForbiddenException);
  assert.equal(wasDeleted(), false);
});

test("eligible Owner purge writes a tombstone audit before deleting", async () => {
  const { prisma, auditEvents, wasDeleted } = archivePrisma({
    id: "client-a", organizationId: "clinic-a", archivedAt: new Date(), retentionUntil: null,
    legalHoldAt: null, legalHoldReason: null,
  });
  const service = new CustomerArchiveService(prisma, { requireSession: async () => owner } as never);
  await service.purge("client-a", "client-a", "Duplicate empty test record", owner);
  assert.equal(wasDeleted(), true);
  assert.equal(auditEvents[0].entityType, "customer_tombstone");
  assert.equal(auditEvents[0].action, "permanently_deleted");
});

test("purge blocks a merge target instead of reactivating archived duplicate identities", async () => {
  const { prisma, wasDeleted } = archivePrisma({
    id: "client-primary", organizationId: "clinic-a", archivedAt: new Date(), retentionUntil: null,
    legalHoldAt: null, legalHoldReason: null,
  }, { mergeSecondaries: 1 });
  const service = new CustomerArchiveService(prisma, { requireSession: async () => owner } as never);

  await assert.rejects(
    service.purge("client-primary", "client-primary", "Requested", owner),
    /merge-secondary Clients depend on its canonical identity/,
  );
  assert.equal(wasDeleted(), false);
});
