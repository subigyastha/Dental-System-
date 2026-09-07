CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_provider_time_no_overlap"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "providerId" WITH =,
    tsrange("startsAt", "endsAt" + ("bufferMinutes" * interval '1 minute'), '[)') WITH &&
  )
  WHERE ("status" IN ('Scheduled', 'Confirmed', 'CheckedIn', 'InProgress'));
