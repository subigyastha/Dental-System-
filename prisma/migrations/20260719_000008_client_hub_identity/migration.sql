-- P3 Client Hub. The physical Customer table remains a compatibility detail;
-- public contracts use Client terminology.

-- The baseline defined this as a unique index rather than a table constraint.
DROP INDEX IF EXISTS "Customer_organizationId_phone_key";

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "normalizedPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "mergedIntoCustomerId" TEXT;

UPDATE "Customer"
SET
  "normalizedPhone" = NULLIF(regexp_replace("phone", '\\D', '', 'g'), ''),
  "normalizedEmail" = NULLIF(lower(btrim("email")), '')
WHERE "normalizedPhone" IS NULL OR "normalizedEmail" IS NULL;

-- Historical PT codes remain valid aliases. Fill missing codes deterministically
-- before the new server-only CL sequence is used.
WITH missing_codes AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") AS sequence
  FROM "Customer"
  WHERE "patientCode" IS NULL
)
UPDATE "Customer" AS customer
SET "patientCode" = 'CL-' || lpad(missing_codes.sequence::text, 6, '0')
FROM missing_codes
WHERE customer."id" = missing_codes."id";

CREATE TABLE IF NOT EXISTS "ClientCodeSequence" (
  "organizationId" TEXT NOT NULL,
  "nextValue" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientCodeSequence_pkey" PRIMARY KEY ("organizationId")
);

INSERT INTO "ClientCodeSequence" ("organizationId", "nextValue", "updatedAt")
SELECT
  "organizationId",
  COALESCE(
    MAX(
      CASE
        WHEN "patientCode" ~ '^CL-[0-9]+$'
          THEN substring("patientCode" FROM 4)::integer
        ELSE 0
      END
    ),
    0
  ) + 1,
  CURRENT_TIMESTAMP
FROM "Customer"
GROUP BY "organizationId"
ON CONFLICT ("organizationId") DO NOTHING;

CREATE TABLE IF NOT EXISTS "ClientAlias" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ClientMerge" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "primaryCustomerId" TEXT NOT NULL,
  "secondaryCustomerId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "relationshipCounts" JSONB NOT NULL,
  "fieldResolution" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientMerge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Customer_organizationId_normalizedPhone_idx"
  ON "Customer"("organizationId", "normalizedPhone");
CREATE INDEX IF NOT EXISTS "Customer_organizationId_normalizedEmail_idx"
  ON "Customer"("organizationId", "normalizedEmail");
CREATE INDEX IF NOT EXISTS "Customer_organizationId_mergedIntoCustomerId_idx"
  ON "Customer"("organizationId", "mergedIntoCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientAlias_organizationId_type_value_key"
  ON "ClientAlias"("organizationId", "type", "value");
CREATE INDEX IF NOT EXISTS "ClientAlias_customerId_idx" ON "ClientAlias"("customerId");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientMerge_secondaryCustomerId_key" ON "ClientMerge"("secondaryCustomerId");
CREATE INDEX IF NOT EXISTS "ClientMerge_organizationId_primaryCustomerId_createdAt_idx"
  ON "ClientMerge"("organizationId", "primaryCustomerId", "createdAt");

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_mergedIntoCustomerId_fkey"
  FOREIGN KEY ("mergedIntoCustomerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientCodeSequence"
  ADD CONSTRAINT "ClientCodeSequence_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientAlias"
  ADD CONSTRAINT "ClientAlias_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientAlias_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientMerge"
  ADD CONSTRAINT "ClientMerge_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientMerge_primaryCustomerId_fkey"
  FOREIGN KEY ("primaryCustomerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientMerge_secondaryCustomerId_fkey"
  FOREIGN KEY ("secondaryCustomerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
