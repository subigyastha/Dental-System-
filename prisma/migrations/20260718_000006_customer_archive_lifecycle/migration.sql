-- Serialized after 000005_additive_role_assignments. This adds lifecycle
-- metadata only; it does not archive, purge, or otherwise alter existing data.
ALTER TABLE "Customer"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedByUserId" TEXT,
  ADD COLUMN "archiveReason" TEXT,
  ADD COLUMN "retentionUntil" TIMESTAMP(3),
  ADD COLUMN "legalHoldAt" TIMESTAMP(3),
  ADD COLUMN "legalHoldReason" TEXT;

CREATE INDEX "Customer_organizationId_archivedAt_idx" ON "Customer"("organizationId", "archivedAt");
CREATE INDEX "Customer_retentionUntil_idx" ON "Customer"("retentionUntil");
CREATE INDEX "Customer_legalHoldAt_idx" ON "Customer"("legalHoldAt");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_archivedByUserId_fkey" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
