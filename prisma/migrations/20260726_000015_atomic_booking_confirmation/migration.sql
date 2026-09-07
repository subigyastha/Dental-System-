CREATE TABLE "BookingConfirmation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "holdId" TEXT,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BookingConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingConfirmation_appointmentId_key"
  ON "BookingConfirmation"("appointmentId");
CREATE UNIQUE INDEX "BookingConfirmation_holdId_key"
  ON "BookingConfirmation"("holdId");
CREATE UNIQUE INDEX "BookingConfirmation_organizationId_actorUserId_idempotencyKey_key"
  ON "BookingConfirmation"("organizationId", "actorUserId", "idempotencyKey");
CREATE INDEX "BookingConfirmation_organizationId_draftId_createdAt_idx"
  ON "BookingConfirmation"("organizationId", "draftId", "createdAt");
CREATE INDEX "BookingConfirmation_customerId_createdAt_idx"
  ON "BookingConfirmation"("customerId", "createdAt");

ALTER TABLE "BookingConfirmation"
  ADD CONSTRAINT "BookingConfirmation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingConfirmation"
  ADD CONSTRAINT "BookingConfirmation_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingConfirmation"
  ADD CONSTRAINT "BookingConfirmation_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingConfirmation"
  ADD CONSTRAINT "BookingConfirmation_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingConfirmation"
  ADD CONSTRAINT "BookingConfirmation_holdId_fkey"
  FOREIGN KEY ("holdId") REFERENCES "BookingSlotHold"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
