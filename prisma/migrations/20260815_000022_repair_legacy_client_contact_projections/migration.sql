-- Seeds and older compatibility writers can create Customer rows after the
-- original ClientPhone expansion migration has run. Repair those projections
-- idempotently so normalized matching and the authoritative phone table agree.
WITH normalized AS (
  SELECT
    customer."id",
    CASE
      WHEN digits LIKE '977%' AND length(digits) >= 10 THEN digits
      WHEN length(digits) = 10 AND digits LIKE '9%' THEN '977' || digits
      WHEN length(digits) BETWEEN 8 AND 10 AND digits LIKE '0%'
        THEN '977' || substring(digits FROM 2)
      ELSE digits
    END AS "normalizedPhone",
    CASE
      WHEN customer."email" IS NULL OR btrim(customer."email") = '' THEN NULL
      ELSE lower(btrim(customer."email"))
    END AS "normalizedEmail"
  FROM "Customer" AS customer
  CROSS JOIN LATERAL (
    SELECT regexp_replace(customer."phone", '[^0-9]', '', 'g') AS digits
  ) AS phone_parts
)
UPDATE "Customer" AS customer
SET
  "normalizedPhone" = NULLIF(normalized."normalizedPhone", ''),
  "normalizedEmail" = normalized."normalizedEmail"
FROM normalized
WHERE customer."id" = normalized."id"
  AND (
    customer."normalizedPhone" IS DISTINCT FROM NULLIF(normalized."normalizedPhone", '')
    OR customer."normalizedEmail" IS DISTINCT FROM normalized."normalizedEmail"
  );

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
    'migration', '20260815_000022_repair_legacy_client_contact_projections'
  ),
  customer."createdAt",
  CURRENT_TIMESTAMP
FROM "Customer" AS customer
WHERE customer."normalizedPhone" IS NOT NULL
  AND customer."normalizedPhone" <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM "ClientPhone" AS phone
    WHERE phone."customerId" = customer."id"
      AND phone."archivedAt" IS NULL
      AND phone."normalizedValue" = customer."normalizedPhone"
  )
ON CONFLICT DO NOTHING;
