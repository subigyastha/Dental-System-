-- Planned reminders and actual contact are separate. Unknown legacy precision
-- and contact methods remain unknown; this migration creates no reminders.
ALTER TABLE "FollowUpTask" ADD COLUMN "dateOnly" BOOLEAN;

ALTER TABLE "CommunicationLog"
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "result" TEXT,
  ADD COLUMN "responseText" TEXT,
  ADD COLUMN "followUpTaskId" TEXT,
  ADD COLUMN "recordedByUserId" TEXT,
  ADD COLUMN "recordedAt" TIMESTAMP(3),
  ADD COLUMN "requestId" TEXT;
UPDATE "CommunicationLog" SET "recordedAt" = "occurredAt";
ALTER TABLE "CommunicationLog" ALTER COLUMN "recordedAt" SET NOT NULL;
ALTER TABLE "CommunicationLog" ALTER COLUMN "recordedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_followUpTaskId_fkey"
  FOREIGN KEY ("followUpTaskId") REFERENCES "FollowUpTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_recordedByUserId_fkey"
  FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "CommunicationLog_followUpTaskId_occurredAt_idx" ON "CommunicationLog"("followUpTaskId", "occurredAt");
CREATE INDEX "CommunicationLog_legacy_audit_idx" ON "CommunicationLog"("organizationId", ("metadata"->>'auditLogId'))
  WHERE "metadata"->>'auditLogId' IS NOT NULL;
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_followup_details_check" CHECK (
  "purpose" IS DISTINCT FROM 'follow_up' OR (
    "channel" IN ('call','whatsapp','sms','email','in_person','other','unknown')
    AND "source" IS NOT NULL AND "source" IN ('manual','integration','import')
    AND ("result" IS NULL OR "result" IN ('reached','no_answer'))
    AND ("responseText" IS NULL OR char_length(btrim("responseText")) BETWEEN 1 AND 2000)
    AND ("result" IS DISTINCT FROM 'no_answer' OR "responseText" IS NULL)
  )
);

-- Preserve the independent staff contact history already written by the local
-- flow. Keep the original audit trail and link it to avoid duplicate display.
INSERT INTO "CommunicationLog" ("id","organizationId","customerId","appointmentId","channel","direction","summary","occurredAt",
  "purpose","source","result","followUpTaskId","recordedByUserId","recordedAt","requestId","metadata")
SELECT 'AuditContact_' || l."id", l."organizationId", c."id", a."id", 'unknown', 'unknown',
  COALESCE(l."description", CASE WHEN l."newValue"->>'result' = 'reached' THEN 'Spoke to client' ELSE 'No answer' END), l."createdAt",
  'follow_up', 'manual', l."newValue"->>'result', t."id", l."actorId", l."createdAt", l."newValue"->>'requestId',
  jsonb_build_object('auditLogId',l."id",'legacy',true)
FROM "AuditLog" l JOIN "Customer" c ON c."id" = l."entityId" AND c."organizationId" = l."organizationId"
LEFT JOIN "Appointment" a ON a."id" = l."newValue"->>'appointmentId' AND a."organizationId" = l."organizationId" AND a."customerId" = c."id"
LEFT JOIN "FollowUpTask" t ON t."id" = l."newValue"->>'taskId' AND t."organizationId" = l."organizationId" AND t."customerId" = c."id"
WHERE l."entityType" = 'client_contact' AND l."action" = 'contact_logged' AND l."newValue"->>'result' IN ('reached','no_answer')
  AND l."newValue"->>'communicationId' IS NULL;

-- Only recover date precision when the latest staff scheduling entry explicitly
-- recorded it and still describes the reminder's current due date.
WITH latest AS (
  SELECT DISTINCT ON (l."organizationId",l."newValue"->>'taskId') l."organizationId", l."newValue"->>'taskId' AS "taskId",
    l."newValue"->'payload'->>'dueAtIso' AS "dueAtIso", l."newValue"->'payload'->>'dateOnly' AS "dateOnly"
  FROM "AuditLog" l WHERE l."entityType" = 'client_contact' AND l."action" = 'followup_scheduled'
  ORDER BY l."organizationId",l."newValue"->>'taskId',l."createdAt" DESC,l."id" DESC
)
UPDATE "FollowUpTask" t SET "dateOnly" = (l."dateOnly" = 'true') FROM latest l
WHERE t."id" = l."taskId" AND t."organizationId" = l."organizationId" AND l."dateOnly" IN ('true','false')
  AND t."dueAt" = l."dueAtIso"::timestamptz;
