-- B5 Client identity expansion.
--
-- Customer remains the physical compatibility table while public contracts use
-- Client terminology. Customer.phone is retained as a compatibility projection;
-- ClientPhone becomes the authoritative, auditable multi-value contact store.

DO $$
BEGIN
  CREATE TYPE "ClientIdentityReviewStatus" AS ENUM (
    'Pending',
    'InReview',
    'Resolved',
    'Dismissed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "ClientIdentityReviewReason" AS ENUM (
    'PriorVisitClaim',
    'SkippedPossibleMatches',
    'ProvisionalClient',
    'DuplicateSignal',
    'Other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE "ClientPhone" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "rawValue" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "normalizationVersion" TEXT NOT NULL DEFAULT 'np-v1',
  "type" TEXT NOT NULL DEFAULT 'Mobile',
  "label" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "verificationStatus" TEXT NOT NULL DEFAULT 'Unverified',
  "verificationSource" TEXT,
  "verificationMetadata" JSONB,
  "verifiedAt" TIMESTAMP(3),
  "verifiedByUserId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'ManualEntry',
  "sourceMetadata" JSONB,
  "createdByUserId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "archivedByUserId" TEXT,
  "archiveReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClientPhone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientIdentityReview" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT,
  "status" "ClientIdentityReviewStatus" NOT NULL DEFAULT 'Pending',
  "version" INTEGER NOT NULL DEFAULT 1,
  "reason" "ClientIdentityReviewReason" NOT NULL,
  -- Immutable array entries keep customerId and score in the same snapshot
  -- object, avoiding positional drift between parallel arrays.
  "candidateSnapshot" JSONB NOT NULL DEFAULT '[]',
  "context" JSONB,
  "createdByUserId" TEXT NOT NULL,
  "resolvedCustomerId" TEXT,
  "resolution" TEXT,
  "resolutionNotes" TEXT,
  "resolutionMetadata" JSONB,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "archivedByUserId" TEXT,
  "archiveReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClientIdentityReview_pkey" PRIMARY KEY ("id")
);

-- Normalize the legacy scalar before backfill so local Nepal mobile/landline
-- formats and +977/00977 representations resolve to the same match key.
-- Non-Nepal international values keep their digits-only representation.
WITH legacy_phone_digits AS (
  SELECT
    "id",
    regexp_replace("phone", '\D', '', 'g') AS digits
  FROM "Customer"
),
normalized_legacy_phones AS (
  SELECT
    "id",
    CASE
      WHEN digits = '' THEN NULL
      WHEN digits LIKE '00977%' THEN substring(digits FROM 3)
      WHEN digits LIKE '977%' THEN digits
      WHEN length(digits) = 10 AND digits LIKE '9%' THEN '977' || digits
      WHEN length(digits) BETWEEN 8 AND 10 AND digits LIKE '0%'
        THEN '977' || substring(digits FROM 2)
      ELSE digits
    END AS "normalizedValue"
  FROM legacy_phone_digits
)
UPDATE "Customer" AS customer
SET "normalizedPhone" = normalized."normalizedValue"
FROM normalized_legacy_phones AS normalized
WHERE customer."id" = normalized."id"
  AND customer."normalizedPhone" IS DISTINCT FROM normalized."normalizedValue";

-- Deterministic IDs make recovery/rehearsal safe. Invalid historical values
-- without any digits remain preserved in Customer.phone but are not promoted to
-- an authoritative searchable phone row.
INSERT INTO "ClientPhone" (
  "id",
  "organizationId",
  "customerId",
  "rawValue",
  "normalizedValue",
  "normalizationVersion",
  "type",
  "isPrimary",
  "verificationStatus",
  "source",
  "sourceMetadata",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy_' || md5(customer."id" || ':Customer.phone'),
  customer."organizationId",
  customer."id",
  customer."phone",
  customer."normalizedPhone",
  'np-v1',
  'Mobile',
  true,
  'Unverified',
  'LegacyBackfill',
  jsonb_build_object(
    'projectionField', 'Customer.phone',
    'migration', '20260725_000013_client_phone_identity_review'
  ),
  customer."createdAt",
  CURRENT_TIMESTAMP
FROM "Customer" AS customer
WHERE customer."normalizedPhone" IS NOT NULL
  AND customer."normalizedPhone" <> ''
ON CONFLICT ("id") DO NOTHING;

CREATE INDEX "ClientPhone_organizationId_normalizedValue_idx"
  ON "ClientPhone"("organizationId", "normalizedValue");
CREATE INDEX "ClientPhone_organizationId_archivedAt_idx"
  ON "ClientPhone"("organizationId", "archivedAt");
CREATE INDEX "ClientPhone_customerId_archivedAt_idx"
  ON "ClientPhone"("customerId", "archivedAt");
CREATE INDEX "ClientPhone_verifiedByUserId_idx"
  ON "ClientPhone"("verifiedByUserId");
CREATE INDEX "ClientPhone_createdByUserId_idx"
  ON "ClientPhone"("createdByUserId");
CREATE INDEX "ClientPhone_archivedByUserId_idx"
  ON "ClientPhone"("archivedByUserId");

-- Shared household numbers are intentionally valid. Only repeated active
-- copies on the same Client are rejected.
CREATE UNIQUE INDEX "ClientPhone_active_customer_normalized_key"
  ON "ClientPhone"("customerId", "normalizedValue")
  WHERE "archivedAt" IS NULL;

-- Keep the compatibility projection unambiguous without preventing archived
-- phone history or shared numbers across Clients.
CREATE UNIQUE INDEX "ClientPhone_active_primary_customer_key"
  ON "ClientPhone"("customerId")
  WHERE "archivedAt" IS NULL AND "isPrimary" = true;

CREATE INDEX "ClientIdentityReview_organizationId_status_createdAt_idx"
  ON "ClientIdentityReview"("organizationId", "status", "createdAt");
CREATE INDEX "ClientIdentityReview_organizationId_reason_createdAt_idx"
  ON "ClientIdentityReview"("organizationId", "reason", "createdAt");
CREATE INDEX "ClientIdentityReview_organizationId_archivedAt_idx"
  ON "ClientIdentityReview"("organizationId", "archivedAt");
CREATE INDEX "ClientIdentityReview_customerId_status_idx"
  ON "ClientIdentityReview"("customerId", "status");
CREATE INDEX "ClientIdentityReview_resolvedCustomerId_idx"
  ON "ClientIdentityReview"("resolvedCustomerId");
CREATE INDEX "ClientIdentityReview_createdByUserId_idx"
  ON "ClientIdentityReview"("createdByUserId");
CREATE INDEX "ClientIdentityReview_resolvedByUserId_idx"
  ON "ClientIdentityReview"("resolvedByUserId");
CREATE INDEX "ClientIdentityReview_archivedByUserId_idx"
  ON "ClientIdentityReview"("archivedByUserId");

ALTER TABLE "ClientPhone"
  ADD CONSTRAINT "ClientPhone_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientPhone_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientPhone_verifiedByUserId_fkey"
  FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientPhone_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientPhone_archivedByUserId_fkey"
  FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClientIdentityReview"
  ADD CONSTRAINT "ClientIdentityReview_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientIdentityReview_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientIdentityReview_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientIdentityReview_resolvedCustomerId_fkey"
  FOREIGN KEY ("resolvedCustomerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientIdentityReview_resolvedByUserId_fkey"
  FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientIdentityReview_archivedByUserId_fkey"
  FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
