-- Close legacy referential-integrity gaps before the affected tables grow.
ALTER TABLE "ClientMerge"
  ADD CONSTRAINT "ClientMerge_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AppointmentSession"
  ADD CONSTRAINT "AppointmentSession_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommunicationLog"
  ADD CONSTRAINT "CommunicationLog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowEvent"
  ADD CONSTRAINT "WorkflowEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Remove indexes whose left-most columns are already covered by an equivalent
-- unique or composite B-tree. This reduces write amplification without losing
-- a supported lookup path.
DROP INDEX IF EXISTS "Location_organizationId_idx";
DROP INDEX IF EXISTS "ProviderService_providerId_idx";
DROP INDEX IF EXISTS "AppointmentSession_appointmentId_idx";
DROP INDEX IF EXISTS "AuditLog_organizationId_idx";

-- Replace priority-first indexes that do not match any current read path with
-- date-oriented indexes used by dashboard and timeline queries.
DROP INDEX IF EXISTS "Appointment_organizationId_status_priority_idx";
DROP INDEX IF EXISTS "FollowUpTask_organizationId_status_priority_dueAt_idx";

CREATE INDEX "Appointment_organizationId_customerId_startsAt_idx"
  ON "Appointment"("organizationId", "customerId", "startsAt");
CREATE INDEX "Appointment_organizationId_status_startsAt_idx"
  ON "Appointment"("organizationId", "status", "startsAt");

CREATE INDEX "FollowUpTask_organizationId_status_dueAt_idx"
  ON "FollowUpTask"("organizationId", "status", "dueAt");
CREATE INDEX "FollowUpTask_organizationId_customerId_dueAt_idx"
  ON "FollowUpTask"("organizationId", "customerId", "dueAt");
CREATE INDEX "FollowUpTask_appointmentId_idx"
  ON "FollowUpTask"("appointmentId");
CREATE INDEX "FollowUpTask_ownerId_idx"
  ON "FollowUpTask"("ownerId");

CREATE INDEX "Invoice_customerId_issuedAt_idx"
  ON "Invoice"("customerId", "issuedAt");
CREATE INDEX "Invoice_organizationId_locationId_issuedAt_idx"
  ON "Invoice"("organizationId", "locationId", "issuedAt");
CREATE INDEX "Invoice_organizationId_issuedAt_idx"
  ON "Invoice"("organizationId", "issuedAt");

CREATE INDEX "FinancialCorrection_organizationId_locationId_requestedAt_idx"
  ON "FinancialCorrection"("organizationId", "locationId", "requestedAt");
CREATE INDEX "FinancialCorrection_organizationId_locationId_executedAt_idx"
  ON "FinancialCorrection"("organizationId", "locationId", "executedAt");

-- Index newly constrained relationships and reverse lookup paths used by
-- deletion checks and appointment/client timelines.
CREATE INDEX "ClientMerge_actorUserId_idx" ON "ClientMerge"("actorUserId");
CREATE INDEX "AppointmentSession_serviceId_idx" ON "AppointmentSession"("serviceId");
CREATE INDEX "CommunicationLog_appointmentId_occurredAt_idx"
  ON "CommunicationLog"("appointmentId", "occurredAt");
CREATE INDEX "WorkflowEvent_actorUserId_idx" ON "WorkflowEvent"("actorUserId");

-- Client directory reads always exclude archived and merged records. Partial
-- indexes keep those hot paths small, while trigram search avoids a full scan
-- for case-insensitive name fragments.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Customer_active_directory_name_idx"
  ON "Customer"("organizationId", "fullName", "id")
  WHERE "archivedAt" IS NULL AND "mergedIntoCustomerId" IS NULL;

CREATE INDEX "Customer_active_directory_recent_idx"
  ON "Customer"(
    "organizationId",
    "lastVisitAt" DESC NULLS LAST,
    "updatedAt" DESC,
    "id" DESC
  )
  WHERE "archivedAt" IS NULL AND "mergedIntoCustomerId" IS NULL;

CREATE INDEX "Customer_active_fullName_trgm_idx"
  ON "Customer" USING GIN ("fullName" gin_trgm_ops)
  WHERE "archivedAt" IS NULL AND "mergedIntoCustomerId" IS NULL;
