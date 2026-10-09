ALTER TABLE "Appointment" ADD COLUMN "customProcedureName" TEXT;
ALTER TABLE "BookingSlotHold" ALTER COLUMN "serviceId" DROP NOT NULL;
ALTER TABLE "BookingSlotHold" ADD COLUMN "customProcedureName" TEXT;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_custom_procedure_name"
  CHECK ("customProcedureName" IS NULL OR char_length(btrim("customProcedureName")) BETWEEN 1 AND 120);
ALTER TABLE "BookingSlotHold" ADD CONSTRAINT "BookingSlotHold_procedure_choice"
  CHECK (("serviceId" IS NOT NULL AND "customProcedureName" IS NULL) OR
         ("serviceId" IS NULL AND char_length(btrim("customProcedureName")) BETWEEN 1 AND 120 AND "customProcedureName" IS NOT NULL));
