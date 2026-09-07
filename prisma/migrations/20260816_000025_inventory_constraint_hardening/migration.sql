-- A movement either has no lot snapshot, or a complete non-negative lot snapshot
-- whose arithmetic matches the posted delta. PostgreSQL CHECK constraints accept
-- UNKNOWN, so the explicit NULL branches are required to reject partial snapshots.
ALTER TABLE "InventoryMovement"
  DROP CONSTRAINT "InventoryMovement_valid_lot_balance";

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_valid_lot_balance" CHECK (
    (
      "lotId" IS NULL
      AND "lotBalanceBefore" IS NULL
      AND "lotBalanceAfter" IS NULL
    )
    OR
    (
      "lotId" IS NOT NULL
      AND "lotBalanceBefore" IS NOT NULL
      AND "lotBalanceAfter" IS NOT NULL
      AND "lotBalanceBefore" >= 0
      AND "lotBalanceAfter" >= 0
      AND "lotBalanceAfter" = "lotBalanceBefore" + "quantityDelta"
    )
  );
