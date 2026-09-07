CREATE TYPE "FinancialCorrectionKind" AS ENUM (
  'InvoiceVoid',
  'Refund',
  'Reversal',
  'PaymentVoid'
);

CREATE TYPE "FinancialCorrectionStatus" AS ENUM (
  'PendingApproval',
  'Executed',
  'Rejected'
);

ALTER TABLE "OrganizationSetting"
  ADD COLUMN "financeCorrectionApprovalThresholdNpr" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "Invoice"
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'NPR';

UPDATE "Invoice" AS invoice
SET "locationId" = appointment."locationId"
FROM "Appointment" AS appointment
WHERE invoice."appointmentId" = appointment."id"
  AND invoice."locationId" IS NULL;

ALTER TABLE "Payment"
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'NPR',
  ADD COLUMN "recordedByUserId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT;

UPDATE "Payment" AS payment
SET "locationId" = COALESCE(invoice."locationId", appointment."locationId")
FROM "Invoice" AS invoice
LEFT JOIN "Appointment" AS appointment ON appointment."id" = invoice."appointmentId"
WHERE payment."invoiceId" = invoice."id"
  AND payment."locationId" IS NULL;

ALTER TABLE "Payment"
  ALTER COLUMN "amount" TYPE DECIMAL(18,2) USING ROUND("amount", 2);

ALTER TABLE "FinancialCorrection"
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "status" "FinancialCorrectionStatus" NOT NULL DEFAULT 'Executed',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'NPR',
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedByUserId" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT;

UPDATE "FinancialCorrection" AS correction
SET "locationId" = COALESCE(
      (
        SELECT payment."locationId"
        FROM "Payment" AS payment
        WHERE payment."id" = correction."paymentId"
      ),
      (
        SELECT invoice."locationId"
        FROM "Invoice" AS invoice
        WHERE invoice."id" = correction."invoiceId"
      )
    ),
    "requestedAt" = correction."createdAt";

ALTER TABLE "FinancialCorrection"
  ALTER COLUMN "amount" TYPE DECIMAL(18,2) USING ROUND("amount", 2),
  ALTER COLUMN "executedAt" DROP DEFAULT,
  ALTER COLUMN "executedAt" DROP NOT NULL,
  ALTER COLUMN "kind" TYPE "FinancialCorrectionKind"
    USING (
      CASE
        WHEN "kind" = 'InvoiceVoid' THEN 'InvoiceVoid'
        WHEN "kind" = 'Refund' THEN 'Refund'
        WHEN "kind" = 'Reversal' THEN 'Reversal'
        ELSE 'PaymentVoid'
      END
    )::"FinancialCorrectionKind";

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_recordedByUserId_fkey"
  FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrection"
  ADD CONSTRAINT "FinancialCorrection_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrection"
  ADD CONSTRAINT "FinancialCorrection_initiatedByUserId_fkey"
  FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrection"
  ADD CONSTRAINT "FinancialCorrection_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrection"
  ADD CONSTRAINT "FinancialCorrection_rejectedByUserId_fkey"
  FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "Payment_currency_npr_check" CHECK ("currency" = 'NPR');
ALTER TABLE "FinancialCorrection"
  ADD CONSTRAINT "FinancialCorrection_amount_nonnegative_check" CHECK ("amount" >= 0),
  ADD CONSTRAINT "FinancialCorrection_currency_npr_check" CHECK ("currency" = 'NPR'),
  ADD CONSTRAINT "FinancialCorrection_version_positive_check" CHECK ("version" > 0),
  ADD CONSTRAINT "FinancialCorrection_terminal_state_check" CHECK (
    ("status" = 'PendingApproval' AND "approvedAt" IS NULL AND "rejectedAt" IS NULL AND "executedAt" IS NULL)
    OR ("status" = 'Executed' AND "rejectedAt" IS NULL AND "executedAt" IS NOT NULL)
    OR ("status" = 'Rejected' AND "approvedAt" IS NULL AND "executedAt" IS NULL AND "rejectedAt" IS NOT NULL)
  );
ALTER TABLE "OrganizationSetting"
  ADD CONSTRAINT "OrganizationSetting_finance_threshold_nonnegative_check"
  CHECK ("financeCorrectionApprovalThresholdNpr" >= 0);

CREATE UNIQUE INDEX "Payment_organizationId_recordedByUserId_idempotencyKey_key"
  ON "Payment"("organizationId", "recordedByUserId", "idempotencyKey");
CREATE INDEX "Payment_organizationId_locationId_paidAt_idx"
  ON "Payment"("organizationId", "locationId", "paidAt");
CREATE UNIQUE INDEX "FinancialCorrection_organizationId_initiatedByUserId_idempotencyKey_key"
  ON "FinancialCorrection"("organizationId", "initiatedByUserId", "idempotencyKey");
CREATE INDEX "FinancialCorrection_organizationId_locationId_status_requestedAt_idx"
  ON "FinancialCorrection"("organizationId", "locationId", "status", "requestedAt");
CREATE INDEX "FinancialCorrection_invoiceId_requestedAt_idx"
  ON "FinancialCorrection"("invoiceId", "requestedAt");
CREATE INDEX "Invoice_organizationId_locationId_status_issuedAt_idx"
  ON "Invoice"("organizationId", "locationId", "status", "issuedAt");
