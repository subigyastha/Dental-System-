CREATE TABLE "ClientCreationReceipt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientCreationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientCreationReceipt_customerId_key"
  ON "ClientCreationReceipt"("customerId");
CREATE UNIQUE INDEX "ClientCreationReceipt_organizationId_actorUserId_idempotencyKey_key"
  ON "ClientCreationReceipt"("organizationId", "actorUserId", "idempotencyKey");
CREATE INDEX "ClientCreationReceipt_organizationId_createdAt_idx"
  ON "ClientCreationReceipt"("organizationId", "createdAt");

ALTER TABLE "ClientCreationReceipt"
  ADD CONSTRAINT "ClientCreationReceipt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientCreationReceipt"
  ADD CONSTRAINT "ClientCreationReceipt_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientCreationReceipt"
  ADD CONSTRAINT "ClientCreationReceipt_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
