import assert from "node:assert/strict";
import test from "node:test";

import { ConflictException, ForbiddenException } from "@nestjs/common";
import { InventoryMovementType, Prisma } from "@prisma/client";

import type { AuthSession } from "../auth/auth.service";
import { InventoryService } from "./inventory.service";

const inventoryActor: AuthSession = {
  id: "inventory-user",
  organizationId: "clinic-a",
  name: "Store Manager",
  email: "inventory@example.test",
  role: "InventoryManager",
  effectiveRoles: [],
  effectiveRoleScopes: [
    { role: "InventoryManager", locationId: "location-a" },
  ],
};

const ownerActor: AuthSession = {
  ...inventoryActor,
  id: "owner-a",
  role: "Owner",
  effectiveRoles: ["Owner", "InventoryManager"],
  effectiveRoleScopes: [
    { role: "Owner", locationId: null },
    { role: "InventoryManager", locationId: null },
  ],
};

const item = {
  id: "item-a",
  organizationId: "clinic-a",
  sku: "GLOVE-M",
  name: "Examination gloves",
  category: "Consumables",
  description: null,
  unit: "box",
  trackLots: false,
  reorderPoint: new Prisma.Decimal("5"),
  preferredStock: new Prisma.Decimal("20"),
  preferredSupplierId: null,
  createdByUserId: "owner-a",
  archivedAt: null,
  archivedByUserId: null,
  archiveReason: null,
  createdAt: new Date("2030-01-01T00:00:00.000Z"),
  updatedAt: new Date("2030-01-01T00:00:00.000Z"),
};

function serviceWith(prisma: Record<string, unknown>, actor: AuthSession = inventoryActor) {
  return new InventoryService(
    prisma as never,
    { requireSession: async () => actor } as never,
  );
}

function movement(overrides: Record<string, unknown> = {}) {
  return {
    id: "movement-a",
    organizationId: "clinic-a",
    itemId: "item-a",
    locationId: "location-a",
    lotId: null,
    supplierId: null,
    type: InventoryMovementType.Receive,
    quantityDelta: new Prisma.Decimal("5"),
    balanceBefore: new Prisma.Decimal("0"),
    balanceAfter: new Prisma.Decimal("5"),
    lotBalanceBefore: null,
    lotBalanceAfter: null,
    transferGroupId: null,
    sourceReference: "GRN-1",
    reason: "Initial receipt",
    occurredAt: new Date("2030-01-01T00:00:00.000Z"),
    postedByUserId: "inventory-user",
    idempotencyKey: "inventory-key-0001",
    sequence: 0,
    requestHash: "hash",
    metadata: null,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    item: { id: "item-a", sku: "GLOVE-M", name: "Examination gloves", unit: "box" },
    location: { id: "location-a", name: "Main clinic" },
    lot: null,
    supplier: null,
    postedBy: { id: "inventory-user", name: "Store Manager" },
    ...overrides,
  };
}

test("Finance does not inherit Inventory access", async () => {
  const financeActor = {
    ...inventoryActor,
    role: "Finance",
    effectiveRoles: ["Finance"],
    effectiveRoleScopes: [{ role: "Finance", locationId: "location-a" }],
  };
  const service = serviceWith({}, financeActor);
  await assert.rejects(
    service.workspace({ locationId: "location-a" }, financeActor),
    ForbiddenException,
  );
  await assert.rejects(
    service.receive(
      {
        itemId: "item-a",
        locationId: "location-a",
        quantity: "1",
        reason: "Received from supplier",
      },
      "inventory-key-0001",
      financeActor,
    ),
    ForbiddenException,
  );
});

test("location-scoped Inventory Manager cannot transfer into an unauthorized location", async () => {
  const service = serviceWith({});
  await assert.rejects(
    service.transfer(
      {
        itemId: "item-a",
        sourceLocationId: "location-a",
        destinationLocationId: "location-b",
        quantity: "1",
        reason: "Move stock to branch",
      },
      "inventory-transfer-01",
      inventoryActor,
    ),
    ForbiddenException,
  );
});

test("a consumption that would produce negative stock is rejected before any write", async () => {
  let movementCreated = false;
  const tx = {
    $executeRaw: async () => 1,
    inventoryMovement: {
      findMany: async () => [],
      create: async () => {
        movementCreated = true;
        return movement();
      },
    },
    inventoryItem: { findFirst: async () => item },
    location: { findFirst: async () => ({ id: "location-a" }) },
    inventoryStockBalance: {
      findUnique: async () => ({
        id: "balance-a",
        quantityOnHand: new Prisma.Decimal("1"),
      }),
    },
  };
  const service = serviceWith({
    inventoryMovement: { findMany: async () => [] },
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  });
  await assert.rejects(
    service.consume(
      {
        itemId: "item-a",
        locationId: "location-a",
        quantity: "2",
        reason: "Used during treatment",
      },
      "inventory-consume-01",
      inventoryActor,
    ),
    (error) => {
      assert.ok(error instanceof ConflictException);
      assert.match(error.message, /negative/i);
      return true;
    },
  );
  assert.equal(movementCreated, false);
});

test("a durable receipt replay does not open a second transaction", async () => {
  const dto = {
    itemId: "item-a",
    locationId: "location-a",
    quantity: "5",
    sourceReference: "GRN-1",
    reason: "Initial receipt",
  };
  const hash = (
    serviceWith({}) as unknown as { hash(value: unknown): string }
  ).hash({ command: "receive", ...dto, quantity: "5.000", expiresAtIso: null });
  let transactions = 0;
  const service = serviceWith({
    inventoryMovement: {
      findMany: async () => [movement({ requestHash: hash })],
    },
    $transaction: async () => {
      transactions += 1;
      throw new Error("must not transact");
    },
  });
  const result = await service.receive(
    dto,
    "inventory-key-0001",
    inventoryActor,
  );
  assert.equal(result.replayed, true);
  assert.equal(result.movements[0].balanceAfter, "5.000");
  assert.equal(transactions, 0);
});

test("Inventory transactions use a hosted-database-safe deadline and retry an expired rollback", async () => {
  let attempts = 0;
  let options: {
    isolationLevel?: Prisma.TransactionIsolationLevel;
    maxWait?: number;
    timeout?: number;
  } | undefined;
  const service = serviceWith({
    $transaction: async (
      callback: (value: Record<string, never>) => Promise<string>,
      receivedOptions: typeof options,
    ) => {
      attempts += 1;
      options = receivedOptions;
      if (attempts === 1) {
        throw new Prisma.PrismaClientKnownRequestError(
          "Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms.",
          { code: "P2028", clientVersion: "test" },
        );
      }
      return callback({});
    },
  });

  const result = await (
    service as unknown as {
      serializable<T>(operation: (tx: Record<string, never>) => Promise<T>): Promise<T>;
    }
  ).serializable(async () => "committed");

  assert.equal(result, "committed");
  assert.equal(attempts, 2);
  assert.deepEqual(options, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 20_000,
  });
});

test("receiving stock posts only Inventory and audit records", async () => {
  let financeTouched = false;
  let movementCreated = false;
  const tx = {
    $executeRaw: async () => 1,
    inventoryMovement: {
      findMany: async () => [],
      create: async () => {
        movementCreated = true;
        return movement({ requestHash: "computed-at-runtime" });
      },
    },
    inventoryItem: { findFirst: async () => item },
    location: { findFirst: async () => ({ id: "location-a" }) },
    inventoryStockBalance: {
      findUnique: async () => null,
      create: async () => ({ id: "balance-a" }),
    },
    auditLog: { create: async () => ({ id: "audit-a" }) },
    invoice: {
      create: async () => {
        financeTouched = true;
      },
    },
    payment: {
      create: async () => {
        financeTouched = true;
      },
    },
  };
  const service = serviceWith({
    inventoryMovement: { findMany: async () => [] },
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  });
  await service.receive(
    {
      itemId: "item-a",
      locationId: "location-a",
      quantity: "5",
      reason: "Received from supplier",
    },
    "inventory-receive-01",
    inventoryActor,
  );
  assert.equal(movementCreated, true);
  assert.equal(financeTouched, false);
});

test("stocktake with no variance records evidence without inventing a movement", async () => {
  let movementCreated = false;
  const stocktakeRecord = {
    id: "stocktake-a",
    organizationId: "clinic-a",
    itemId: "item-a",
    locationId: "location-a",
    lotId: null,
    systemQuantity: new Prisma.Decimal("5"),
    countedQuantity: new Prisma.Decimal("5"),
    varianceQuantity: new Prisma.Decimal("0"),
    reason: "Monthly count",
    countedAt: new Date("2030-01-01T00:00:00.000Z"),
    movementId: null,
    createdByUserId: "inventory-user",
    idempotencyKey: "inventory-stocktake-01",
    requestHash: "hash",
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    item: { id: "item-a", sku: "GLOVE-M", name: "Examination gloves", unit: "box" },
    location: { id: "location-a", name: "Main clinic" },
    lot: null,
    movement: null,
    createdBy: { id: "inventory-user", name: "Store Manager" },
  };
  const tx = {
    $executeRaw: async () => 1,
    inventoryStocktake: {
      findUnique: async () => null,
      create: async ({ data }: { data: { requestHash: string } }) => ({
        ...stocktakeRecord,
        requestHash: data.requestHash,
      }),
    },
    inventoryMovement: {
      create: async () => {
        movementCreated = true;
        return movement();
      },
    },
    inventoryItem: { findFirst: async () => item },
    location: { findFirst: async () => ({ id: "location-a" }) },
    inventoryStockBalance: {
      findUnique: async () => ({ quantityOnHand: new Prisma.Decimal("5") }),
    },
    auditLog: { create: async () => ({ id: "audit-a" }) },
  };
  const service = serviceWith({
    inventoryStocktake: { findUnique: async () => null },
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  });
  const result = await service.stocktake(
    {
      itemId: "item-a",
      locationId: "location-a",
      countedQuantity: "5",
      countedAtIso: "2030-01-01T00:00:00.000Z",
      reason: "Monthly count",
    },
    "inventory-stocktake-01",
    inventoryActor,
  );
  assert.equal(result.stocktake.varianceQuantity, "0.000");
  assert.equal(result.stocktake.movement, null);
  assert.equal(movementCreated, false);
});

test("an item with remaining stock cannot be archived", async () => {
  const service = serviceWith(
    {
      inventoryItem: { findFirst: async () => item },
      inventoryStockBalance: {
        aggregate: async () => ({ _sum: { quantityOnHand: new Prisma.Decimal("1") } }),
      },
    },
    ownerActor,
  );
  await assert.rejects(
    service.archiveItem(
      "item-a",
      { reason: "No longer stocked" },
      ownerActor,
    ),
    ConflictException,
  );
});

test("an Owner can update audited reorder settings without changing the SKU", async () => {
  let auditCreated = false;
  const updatedItem = {
    ...item,
    name: "Examination gloves, medium",
    reorderPoint: new Prisma.Decimal("8"),
    preferredStock: new Prisma.Decimal("24"),
  };
  const tx = {
    inventoryItem: { update: async () => updatedItem },
    auditLog: {
      create: async () => {
        auditCreated = true;
        return { id: "audit-update" };
      },
    },
  };
  const service = serviceWith(
    {
      inventoryItem: { findFirst: async () => item },
      $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    },
    ownerActor,
  );

  const result = await service.updateItem(
    "item-a",
    {
      name: "Examination gloves, medium",
      reorderPoint: "8",
      preferredStock: "24",
    },
    ownerActor,
  );

  assert.equal(result.item.reorderPoint, "8.000");
  assert.equal(result.item.preferredStock, "24.000");
  assert.equal(result.item.sku, "GLOVE-M");
  assert.equal(auditCreated, true);
});

test("lot tracking policy is locked after the first stock movement", async () => {
  const service = serviceWith(
    {
      inventoryItem: { findFirst: async () => item },
      inventoryMovement: { count: async () => 1 },
    },
    ownerActor,
  );

  await assert.rejects(
    service.updateItem("item-a", { trackLots: true }, ownerActor),
    ConflictException,
  );
});
