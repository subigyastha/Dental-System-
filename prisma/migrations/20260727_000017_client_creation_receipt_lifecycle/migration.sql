ALTER TABLE "ClientCreationReceipt"
  DROP CONSTRAINT "ClientCreationReceipt_customerId_fkey";

ALTER TABLE "ClientCreationReceipt"
  ADD CONSTRAINT "ClientCreationReceipt_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
