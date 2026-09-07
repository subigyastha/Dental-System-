ALTER TABLE "OrganizationSetting"
  ADD COLUMN "slotStartIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "scheduleConfigurationVersion" INTEGER NOT NULL DEFAULT 1;

-- Production scheduling is conflict-safe; retire any legacy overlap toggle.
UPDATE "OrganizationSetting" SET "allowOverlaps" = FALSE WHERE "allowOverlaps" = TRUE;
UPDATE "Organization" SET "primaryCalendar" = 'AD' WHERE "primaryCalendar" <> 'AD';

ALTER TABLE "OrganizationSetting"
  ADD CONSTRAINT "OrganizationSetting_slotStartIntervalMinutes_check"
  CHECK ("slotStartIntervalMinutes" IN (5, 10, 15, 20, 30, 60)),
  ADD CONSTRAINT "OrganizationSetting_scheduleConfigurationVersion_check"
  CHECK ("scheduleConfigurationVersion" >= 1),
  ADD CONSTRAINT "OrganizationSetting_bookingHoldMinutes_check"
  CHECK ("bookingHoldMinutes" BETWEEN 1 AND 10),
  ADD CONSTRAINT "OrganizationSetting_businessDayOrder_check"
  CHECK ("businessDayStartsAt" < "businessDayEndsAt"),
  ADD CONSTRAINT "OrganizationSetting_noOverbooking_check"
  CHECK ("allowOverlaps" = FALSE);
