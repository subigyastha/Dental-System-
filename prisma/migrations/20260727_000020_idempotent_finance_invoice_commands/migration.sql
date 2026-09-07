ALTER TABLE "Invoice"
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "issuedByUserId" TEXT,
  ADD COLUMN "issueIdempotencyKey" TEXT,
  ADD COLUMN "issueRequestHash" TEXT;

ALTER TABLE "FinancialCorrection"
  ALTER COLUMN "status" SET DEFAULT 'PendingApproval';

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_issuedByUserId_fkey"
  FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Invoice_organizationId_createdByUserId_idempotencyKey_key"
  ON "Invoice"("organizationId", "createdByUserId", "idempotencyKey");
CREATE UNIQUE INDEX "Invoice_organizationId_issuedByUserId_issueIdempotencyKey_key"
  ON "Invoice"("organizationId", "issuedByUserId", "issueIdempotencyKey");
