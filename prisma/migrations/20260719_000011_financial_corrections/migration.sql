CREATE TABLE "InvoiceNumberSequence" (
  "organizationId" TEXT NOT NULL,
  "nextValue" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceNumberSequence_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "FinancialCorrection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "initiatedByUserId" TEXT NOT NULL,
  "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "providerReference" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialCorrection_pkey" PRIMARY KEY ("id")
);

INSERT INTO "InvoiceNumberSequence" ("organizationId", "nextValue", "updatedAt")
SELECT "organizationId", COUNT(*) + 1, CURRENT_TIMESTAMP FROM "Invoice" GROUP BY "organizationId";

ALTER TABLE "InvoiceNumberSequence" ADD CONSTRAINT "InvoiceNumberSequence_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrection" ADD CONSTRAINT "FinancialCorrection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrection" ADD CONSTRAINT "FinancialCorrection_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrection" ADD CONSTRAINT "FinancialCorrection_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "FinancialCorrection_organizationId_executedAt_idx" ON "FinancialCorrection"("organizationId", "executedAt");
CREATE INDEX "FinancialCorrection_invoiceId_executedAt_idx" ON "FinancialCorrection"("invoiceId", "executedAt");
CREATE INDEX "FinancialCorrection_paymentId_idx" ON "FinancialCorrection"("paymentId");
