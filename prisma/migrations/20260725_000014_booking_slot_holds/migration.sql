ALTER TABLE "OrganizationSetting"
  ADD COLUMN "bookingHoldMinutes" INTEGER NOT NULL DEFAULT 3,
  ADD CONSTRAINT "OrganizationSetting_bookingHoldMinutes_range"
    CHECK ("bookingHoldMinutes" BETWEEN 1 AND 10);

CREATE TABLE "BookingSlotHold" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "bufferMinutes" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BookingSlotHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingSlotHold_positive_buffer" CHECK ("bufferMinutes" >= 0),
  CONSTRAINT "BookingSlotHold_valid_interval" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "BookingSlotHold_valid_expiry" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "BookingSlotHold_single_terminal_state" CHECK (
    "releasedAt" IS NULL OR "consumedAt" IS NULL
  )
);

CREATE INDEX "BookingSlotHold_organizationId_providerId_startsAt_expiresAt_idx"
  ON "BookingSlotHold"("organizationId", "providerId", "startsAt", "expiresAt");

CREATE INDEX "BookingSlotHold_organizationId_locationId_expiresAt_idx"
  ON "BookingSlotHold"("organizationId", "locationId", "expiresAt");

CREATE INDEX "BookingSlotHold_createdByUserId_expiresAt_idx"
  ON "BookingSlotHold"("createdByUserId", "expiresAt");

CREATE INDEX "BookingSlotHold_organizationId_createdByUserId_draftId_expiresAt_idx"
  ON "BookingSlotHold"("organizationId", "createdByUserId", "draftId", "expiresAt");

CREATE UNIQUE INDEX "BookingSlotHold_organizationId_createdByUserId_idempotencyKey_key"
  ON "BookingSlotHold"("organizationId", "createdByUserId", "idempotencyKey");

ALTER TABLE "BookingSlotHold"
  ADD CONSTRAINT "BookingSlotHold_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingSlotHold"
  ADD CONSTRAINT "BookingSlotHold_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingSlotHold"
  ADD CONSTRAINT "BookingSlotHold_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingSlotHold"
  ADD CONSTRAINT "BookingSlotHold_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BookingSlotHold"
  ADD CONSTRAINT "BookingSlotHold_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
