-- Serialized after 000006_customer_archive_lifecycle. Platform controls store
-- configuration and de-identified organization-level telemetry only.
CREATE TYPE "SupportAccessGrantStatus" AS ENUM ('Active', 'Revoked', 'Expired');

CREATE TABLE "PlatformFeatureFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformFeatureFlag_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "OrganizationFeatureOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationFeatureOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeatureAdoptionEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeatureAdoptionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportAccessGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "dataDomains" TEXT[] NOT NULL,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "SupportAccessGrantStatus" NOT NULL DEFAULT 'Active',
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformAuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformFeatureFlag_enabled_idx" ON "PlatformFeatureFlag"("enabled");
CREATE INDEX "PlatformFeatureFlag_updatedByUserId_idx" ON "PlatformFeatureFlag"("updatedByUserId");
CREATE UNIQUE INDEX "OrganizationFeatureOverride_organizationId_featureKey_key" ON "OrganizationFeatureOverride"("organizationId", "featureKey");
CREATE INDEX "OrganizationFeatureOverride_featureKey_idx" ON "OrganizationFeatureOverride"("featureKey");
CREATE INDEX "OrganizationFeatureOverride_updatedByUserId_idx" ON "OrganizationFeatureOverride"("updatedByUserId");
CREATE INDEX "FeatureAdoptionEvent_featureKey_occurredAt_idx" ON "FeatureAdoptionEvent"("featureKey", "occurredAt");
CREATE INDEX "FeatureAdoptionEvent_organizationId_featureKey_idx" ON "FeatureAdoptionEvent"("organizationId", "featureKey");
CREATE INDEX "SupportAccessGrant_organizationId_status_expiresAt_idx" ON "SupportAccessGrant"("organizationId", "status", "expiresAt");
CREATE INDEX "SupportAccessGrant_requestedByUserId_idx" ON "SupportAccessGrant"("requestedByUserId");
CREATE INDEX "SupportAccessGrant_revokedByUserId_idx" ON "SupportAccessGrant"("revokedByUserId");
CREATE INDEX "PlatformAuditEvent_actorUserId_idx" ON "PlatformAuditEvent"("actorUserId");
CREATE INDEX "PlatformAuditEvent_entityType_entityId_idx" ON "PlatformAuditEvent"("entityType", "entityId");
CREATE INDEX "PlatformAuditEvent_createdAt_idx" ON "PlatformAuditEvent"("createdAt");

ALTER TABLE "PlatformFeatureFlag" ADD CONSTRAINT "PlatformFeatureFlag_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationFeatureOverride" ADD CONSTRAINT "OrganizationFeatureOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationFeatureOverride" ADD CONSTRAINT "OrganizationFeatureOverride_featureKey_fkey" FOREIGN KEY ("featureKey") REFERENCES "PlatformFeatureFlag"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationFeatureOverride" ADD CONSTRAINT "OrganizationFeatureOverride_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeatureAdoptionEvent" ADD CONSTRAINT "FeatureAdoptionEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
