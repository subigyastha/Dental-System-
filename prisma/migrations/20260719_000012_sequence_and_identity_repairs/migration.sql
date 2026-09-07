-- Repair sequence and identity backfills introduced before the corresponding
-- server-side guards existed. This migration is safe for databases that have
-- already applied the earlier P3/P4 migrations and for new installations.

-- In PostgreSQL regex literals use one backslash for the non-digit class.
-- Recompute every row so formatted historical phones become searchable and
-- participate in duplicate detection just like newly created Clients.
UPDATE "Customer"
SET "normalizedPhone" = NULLIF(regexp_replace("phone", '\D', '', 'g'), '')
WHERE "normalizedPhone" IS DISTINCT FROM NULLIF(regexp_replace("phone", '\D', '', 'g'), '');

-- Automatic invoice numbers must start after the greatest already-reserved
-- numeric INV- number, not after the number of rows (which can have gaps).
WITH sequence_floor AS (
  SELECT
    "organizationId",
    COALESCE(
      MAX(
        CASE
          WHEN "invoiceNumber" ~ '^INV-[0-9]+$'
            THEN substring("invoiceNumber" FROM 5)::integer
          ELSE 0
        END
      ),
      0
    ) + 1 AS "nextValue"
  FROM "Invoice"
  GROUP BY "organizationId"
)
INSERT INTO "InvoiceNumberSequence" ("organizationId", "nextValue", "createdAt", "updatedAt")
SELECT "organizationId", "nextValue", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM sequence_floor
ON CONFLICT ("organizationId") DO UPDATE
SET "nextValue" = GREATEST("InvoiceNumberSequence"."nextValue", EXCLUDED."nextValue"),
    "updatedAt" = CURRENT_TIMESTAMP;
