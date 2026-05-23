-- CreateTable
CREATE TABLE "ProviderRecurringBlock" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "locationId" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "startsAtLocal" TEXT NOT NULL,
    "endsAtLocal" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderRecurringBlock_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AppointmentSession"
ADD COLUMN "dentalChartUpdated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "chartNote" TEXT;

-- CreateTable
CREATE TABLE "PatientDentalChart" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "chartData" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByProviderId" TEXT,
    "sourceAppointmentSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientDentalChart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DentalChartRevision" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "appointmentSessionId" TEXT,
    "createdByProviderId" TEXT,
    "chartData" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DentalChartRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderRecurringBlock_organizationId_providerId_dayOfWeek_isActive_idx" ON "ProviderRecurringBlock"("organizationId", "providerId", "dayOfWeek", "isActive");

-- CreateIndex
CREATE INDEX "ProviderRecurringBlock_locationId_idx" ON "ProviderRecurringBlock"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientDentalChart_customerId_key" ON "PatientDentalChart"("customerId");

-- CreateIndex
CREATE INDEX "PatientDentalChart_updatedByProviderId_idx" ON "PatientDentalChart"("updatedByProviderId");

-- CreateIndex
CREATE INDEX "PatientDentalChart_sourceAppointmentSessionId_idx" ON "PatientDentalChart"("sourceAppointmentSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "DentalChartRevision_appointmentSessionId_key" ON "DentalChartRevision"("appointmentSessionId");

-- CreateIndex
CREATE INDEX "DentalChartRevision_customerId_createdAt_idx" ON "DentalChartRevision"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "DentalChartRevision_createdByProviderId_idx" ON "DentalChartRevision"("createdByProviderId");

-- AddForeignKey
ALTER TABLE "ProviderRecurringBlock" ADD CONSTRAINT "ProviderRecurringBlock_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRecurringBlock" ADD CONSTRAINT "ProviderRecurringBlock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDentalChart" ADD CONSTRAINT "PatientDentalChart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDentalChart" ADD CONSTRAINT "PatientDentalChart_updatedByProviderId_fkey" FOREIGN KEY ("updatedByProviderId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDentalChart" ADD CONSTRAINT "PatientDentalChart_sourceAppointmentSessionId_fkey" FOREIGN KEY ("sourceAppointmentSessionId") REFERENCES "AppointmentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChartRevision" ADD CONSTRAINT "DentalChartRevision_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChartRevision" ADD CONSTRAINT "DentalChartRevision_appointmentSessionId_fkey" FOREIGN KEY ("appointmentSessionId") REFERENCES "AppointmentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DentalChartRevision" ADD CONSTRAINT "DentalChartRevision_createdByProviderId_fkey" FOREIGN KEY ("createdByProviderId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
