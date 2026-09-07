-- P4A: Gregorian/AD is the persisted and default calendar system. BS remains
-- a derived display option supplied by the calendar conversion service.
ALTER TABLE "Organization"
  ALTER COLUMN "primaryCalendar" SET DEFAULT 'AD';

-- Existing clinics previously inherited the baseline BS default. No business
-- timestamps are transformed: all persisted appointment values are already
-- Gregorian timestamps. This only corrects the display/default preference.
UPDATE "Organization"
SET "primaryCalendar" = 'AD'
WHERE "primaryCalendar" = 'BS';
