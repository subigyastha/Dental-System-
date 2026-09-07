-- Guard high-value invariants at the commit boundary. Service-layer validation
-- remains responsible for user-friendly errors; these checks protect against
-- races, scripts, and future write paths.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_valid_interval_check"
    CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "Appointment_positive_duration_check"
    CHECK ("durationMinutes" > 0),
  ADD CONSTRAINT "Appointment_nonnegative_buffer_check"
    CHECK ("bufferMinutes" >= 0);

ALTER TABLE "Service"
  ADD CONSTRAINT "Service_positive_duration_check"
    CHECK ("durationMinutes" > 0),
  ADD CONSTRAINT "Service_nonnegative_buffer_check"
    CHECK ("bufferMinutes" >= 0),
  ADD CONSTRAINT "Service_nonnegative_price_check"
    CHECK ("price" IS NULL OR "price" >= 0);

ALTER TABLE "ProviderAvailability"
  ADD CONSTRAINT "ProviderAvailability_weekday_check"
    CHECK ("dayOfWeek" BETWEEN 0 AND 6),
  ADD CONSTRAINT "ProviderAvailability_local_time_format_check"
    CHECK (
      "startsAtLocal" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND "endsAtLocal" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ),
  ADD CONSTRAINT "ProviderAvailability_valid_local_interval_check"
    CHECK ("endsAtLocal" > "startsAtLocal"),
  ADD CONSTRAINT "ProviderAvailability_positive_slot_check"
    CHECK ("slotDurationMinutes" > 0),
  ADD CONSTRAINT "ProviderAvailability_nonnegative_buffer_check"
    CHECK ("bufferMinutes" >= 0),
  ADD CONSTRAINT "ProviderAvailability_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

ALTER TABLE "ProviderRecurringBlock"
  ADD CONSTRAINT "ProviderRecurringBlock_weekday_check"
    CHECK ("dayOfWeek" BETWEEN 0 AND 6),
  ADD CONSTRAINT "ProviderRecurringBlock_local_time_format_check"
    CHECK (
      "startsAtLocal" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND "endsAtLocal" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ),
  ADD CONSTRAINT "ProviderRecurringBlock_valid_interval_check"
    CHECK ("endsAtLocal" > "startsAtLocal");

ALTER TABLE "BlockedTime"
  ADD CONSTRAINT "BlockedTime_valid_interval_check"
    CHECK ("endsAt" > "startsAt");

ALTER TABLE "OrganizationSetting"
  ADD CONSTRAINT "OrganizationSetting_default_buffer_nonnegative_check"
    CHECK ("defaultBufferMinutes" >= 0),
  ADD CONSTRAINT "OrganizationSetting_reminder_lead_nonnegative_check"
    CHECK ("reminderLeadMinutes" >= 0),
  ADD CONSTRAINT "OrganizationSetting_business_time_format_check"
    CHECK (
      "businessDayStartsAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND "businessDayEndsAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ),
  ADD CONSTRAINT "OrganizationSetting_business_interval_check"
    CHECK ("businessDayEndsAt" > "businessDayStartsAt");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_nonnegative_amounts_check"
    CHECK (
      "subtotal" >= 0
      AND "discountAmount" >= 0
      AND "taxAmount" >= 0
      AND "totalAmount" >= 0
      AND "balanceAmount" >= 0
    ),
  ADD CONSTRAINT "Invoice_balance_within_total_check"
    CHECK ("balanceAmount" <= "totalAmount");

ALTER TABLE "InvoiceLineItem"
  ADD CONSTRAINT "InvoiceLineItem_positive_quantity_check"
    CHECK ("quantity" > 0),
  ADD CONSTRAINT "InvoiceLineItem_nonnegative_amounts_check"
    CHECK (
      "unitPrice" >= 0
      AND "discountAmount" >= 0
      AND "taxAmount" >= 0
      AND "lineTotal" >= 0
    );

ALTER TABLE "ClientCodeSequence"
  ADD CONSTRAINT "ClientCodeSequence_positive_next_value_check"
    CHECK ("nextValue" > 0);

ALTER TABLE "InvoiceNumberSequence"
  ADD CONSTRAINT "InvoiceNumberSequence_positive_next_value_check"
    CHECK ("nextValue" > 0);

ALTER TABLE "ClientIdentityReview"
  ADD CONSTRAINT "ClientIdentityReview_positive_version_check"
    CHECK ("version" > 0);

ALTER TABLE "PatientDentalChart"
  ADD CONSTRAINT "PatientDentalChart_positive_version_check"
    CHECK ("version" > 0);

-- PostgreSQL treats NULL values as distinct in the existing three-column
-- ProviderService unique index. Close the null-location hole explicitly.
CREATE UNIQUE INDEX "ProviderService_providerId_serviceId_null_location_key"
  ON "ProviderService"("providerId", "serviceId")
  WHERE "locationId" IS NULL;

-- Role grants retain history after revocation, but only one equivalent active
-- grant may exist. Separate indexes handle scoped and organization-wide roles.
CREATE UNIQUE INDEX "RoleAssignment_active_scoped_role_key"
  ON "RoleAssignment"("membershipId", "role", "locationId")
  WHERE "revokedAt" IS NULL AND "locationId" IS NOT NULL;

CREATE UNIQUE INDEX "RoleAssignment_active_organization_role_key"
  ON "RoleAssignment"("membershipId", "role")
  WHERE "revokedAt" IS NULL AND "locationId" IS NULL;
