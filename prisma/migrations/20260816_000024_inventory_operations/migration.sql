CREATE TYPE "InventoryMovementType" AS ENUM (
  'OpeningBalance',
  'Receive',
  'Consume',
  'AdjustIncrease',
  'AdjustDecrease',
  'TransferOut',
  'TransferIn',
  'ReturnToStock',
  'Quarantine',
  'ReleaseFromQuarantine',
  'Waste',
  'StocktakeReconciliation'
);

CREATE TYPE "InventoryLotStatus" AS ENUM (
  'Available',
  'Quarantined',
  'Exhausted',
  'Expired'
);

CREATE TABLE "InventorySupplier" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contactName" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "archivedByUserId" TEXT,
  "archiveReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventorySupplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "description" TEXT,
  "unit" TEXT NOT NULL,
  "trackLots" BOOLEAN NOT NULL DEFAULT false,
  "reorderPoint" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "preferredStock" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "preferredSupplierId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "archivedByUserId" TEXT,
  "archiveReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryItem_nonnegative_thresholds" CHECK (
    "reorderPoint" >= 0 AND "preferredStock" >= 0
  )
);

CREATE TABLE "InventoryLot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "supplierId" TEXT,
  "lotNumber" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "status" "InventoryLotStatus" NOT NULL DEFAULT 'Available',
  "quantityOnHand" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryLot_nonnegative_quantity" CHECK ("quantityOnHand" >= 0),
  CONSTRAINT "InventoryLot_valid_expiry" CHECK ("expiresAt" IS NULL OR "expiresAt" > "receivedAt")
);

CREATE TABLE "InventoryStockBalance" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "quantityOnHand" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "lastMovementAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryStockBalance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryStockBalance_nonnegative_quantity" CHECK ("quantityOnHand" >= 0)
);

CREATE TABLE "InventoryMovement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "lotId" TEXT,
  "supplierId" TEXT,
  "type" "InventoryMovementType" NOT NULL,
  "quantityDelta" DECIMAL(18,3) NOT NULL,
  "balanceBefore" DECIMAL(18,3) NOT NULL,
  "balanceAfter" DECIMAL(18,3) NOT NULL,
  "lotBalanceBefore" DECIMAL(18,3),
  "lotBalanceAfter" DECIMAL(18,3),
  "transferGroupId" TEXT,
  "sourceReference" TEXT,
  "reason" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "postedByUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "requestHash" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryMovement_nonzero_quantity" CHECK ("quantityDelta" <> 0),
  CONSTRAINT "InventoryMovement_valid_balance" CHECK (
    "balanceBefore" >= 0 AND
    "balanceAfter" >= 0 AND
    "balanceBefore" + "quantityDelta" = "balanceAfter"
  ),
  CONSTRAINT "InventoryMovement_valid_lot_balance" CHECK (
    ("lotBalanceBefore" IS NULL AND "lotBalanceAfter" IS NULL) OR
    ("lotBalanceBefore" >= 0 AND "lotBalanceAfter" >= 0 AND
      "lotBalanceBefore" + "quantityDelta" = "lotBalanceAfter")
  )
);

CREATE TABLE "InventoryStocktake" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "lotId" TEXT,
  "systemQuantity" DECIMAL(18,3) NOT NULL,
  "countedQuantity" DECIMAL(18,3) NOT NULL,
  "varianceQuantity" DECIMAL(18,3) NOT NULL,
  "reason" TEXT NOT NULL,
  "countedAt" TIMESTAMP(3) NOT NULL,
  "movementId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryStocktake_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryStocktake_valid_quantities" CHECK (
    "systemQuantity" >= 0 AND
    "countedQuantity" >= 0 AND
    "countedQuantity" - "systemQuantity" = "varianceQuantity"
  )
);

CREATE UNIQUE INDEX "InventorySupplier_organizationId_code_key" ON "InventorySupplier"("organizationId", "code");
CREATE INDEX "InventorySupplier_organizationId_archivedAt_name_idx" ON "InventorySupplier"("organizationId", "archivedAt", "name");
CREATE UNIQUE INDEX "InventoryItem_organizationId_sku_key" ON "InventoryItem"("organizationId", "sku");
CREATE INDEX "InventoryItem_organizationId_archivedAt_name_idx" ON "InventoryItem"("organizationId", "archivedAt", "name");
CREATE INDEX "InventoryItem_organizationId_category_archivedAt_idx" ON "InventoryItem"("organizationId", "category", "archivedAt");
CREATE INDEX "InventoryItem_preferredSupplierId_idx" ON "InventoryItem"("preferredSupplierId");
CREATE UNIQUE INDEX "InventoryLot_organizationId_itemId_locationId_lotNumber_key" ON "InventoryLot"("organizationId", "itemId", "locationId", "lotNumber");
CREATE INDEX "InventoryLot_organizationId_locationId_status_expiresAt_idx" ON "InventoryLot"("organizationId", "locationId", "status", "expiresAt");
CREATE INDEX "InventoryLot_organizationId_itemId_locationId_idx" ON "InventoryLot"("organizationId", "itemId", "locationId");
CREATE INDEX "InventoryLot_supplierId_idx" ON "InventoryLot"("supplierId");
CREATE UNIQUE INDEX "InventoryStockBalance_organizationId_itemId_locationId_key" ON "InventoryStockBalance"("organizationId", "itemId", "locationId");
CREATE INDEX "InventoryStockBalance_organizationId_locationId_quantityOnHand_idx" ON "InventoryStockBalance"("organizationId", "locationId", "quantityOnHand");
CREATE INDEX "InventoryStockBalance_organizationId_itemId_idx" ON "InventoryStockBalance"("organizationId", "itemId");
CREATE UNIQUE INDEX "InventoryMovement_organizationId_postedByUserId_idempotencyKey_sequence_key" ON "InventoryMovement"("organizationId", "postedByUserId", "idempotencyKey", "sequence");
CREATE INDEX "InventoryMovement_organizationId_locationId_occurredAt_idx" ON "InventoryMovement"("organizationId", "locationId", "occurredAt");
CREATE INDEX "InventoryMovement_organizationId_itemId_occurredAt_idx" ON "InventoryMovement"("organizationId", "itemId", "occurredAt");
CREATE INDEX "InventoryMovement_organizationId_transferGroupId_idx" ON "InventoryMovement"("organizationId", "transferGroupId");
CREATE INDEX "InventoryMovement_lotId_occurredAt_idx" ON "InventoryMovement"("lotId", "occurredAt");
CREATE INDEX "InventoryMovement_supplierId_idx" ON "InventoryMovement"("supplierId");
CREATE UNIQUE INDEX "InventoryStocktake_movementId_key" ON "InventoryStocktake"("movementId");
CREATE UNIQUE INDEX "InventoryStocktake_organizationId_createdByUserId_idempotencyKey_key" ON "InventoryStocktake"("organizationId", "createdByUserId", "idempotencyKey");
CREATE INDEX "InventoryStocktake_organizationId_locationId_countedAt_idx" ON "InventoryStocktake"("organizationId", "locationId", "countedAt");
CREATE INDEX "InventoryStocktake_organizationId_itemId_countedAt_idx" ON "InventoryStocktake"("organizationId", "itemId", "countedAt");
CREATE INDEX "InventoryStocktake_lotId_idx" ON "InventoryStocktake"("lotId");
CREATE INDEX "InventoryStocktake_createdByUserId_idx" ON "InventoryStocktake"("createdByUserId");

ALTER TABLE "InventorySupplier" ADD CONSTRAINT "InventorySupplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventorySupplier" ADD CONSTRAINT "InventorySupplier_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventorySupplier" ADD CONSTRAINT "InventorySupplier_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "InventorySupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "InventorySupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStockBalance" ADD CONSTRAINT "InventoryStockBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryStockBalance" ADD CONSTRAINT "InventoryStockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStockBalance" ADD CONSTRAINT "InventoryStockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "InventorySupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStocktake" ADD CONSTRAINT "InventoryStocktake_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryStocktake" ADD CONSTRAINT "InventoryStocktake_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStocktake" ADD CONSTRAINT "InventoryStocktake_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStocktake" ADD CONSTRAINT "InventoryStocktake_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStocktake" ADD CONSTRAINT "InventoryStocktake_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStocktake" ADD CONSTRAINT "InventoryStocktake_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_inventory_movement_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movements are immutable; post a compensating movement instead.' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryMovement_immutable_update"
BEFORE UPDATE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION "reject_inventory_movement_mutation"();

CREATE TRIGGER "InventoryMovement_immutable_delete"
BEFORE DELETE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION "reject_inventory_movement_mutation"();
