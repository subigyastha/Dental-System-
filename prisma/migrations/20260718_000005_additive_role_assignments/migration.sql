-- Additive RBAC migration. Legacy User.organizationId/User.role remains the
-- runtime authority until an explicit, audited backfill and dual-read cutover.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'Finance';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'InventoryManager';

CREATE TYPE "OrganizationMembershipStatus" AS ENUM ('Active', 'Suspended', 'Revoked');

CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OrganizationMembershipStatus" NOT NULL DEFAULT 'Active',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedReason" TEXT,
    "grantedByUserId" TEXT,
    "grantReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "locationId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedReason" TEXT,
    "grantedByUserId" TEXT,
    "grantReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");
CREATE INDEX "OrganizationMembership_userId_status_idx" ON "OrganizationMembership"("userId", "status");
CREATE INDEX "OrganizationMembership_organizationId_status_idx" ON "OrganizationMembership"("organizationId", "status");
CREATE INDEX "OrganizationMembership_effectiveFrom_effectiveTo_idx" ON "OrganizationMembership"("effectiveFrom", "effectiveTo");
CREATE INDEX "OrganizationMembership_grantedByUserId_idx" ON "OrganizationMembership"("grantedByUserId");
CREATE INDEX "OrganizationMembership_revokedByUserId_idx" ON "OrganizationMembership"("revokedByUserId");
CREATE INDEX "RoleAssignment_membershipId_role_idx" ON "RoleAssignment"("membershipId", "role");
CREATE INDEX "RoleAssignment_locationId_idx" ON "RoleAssignment"("locationId");
CREATE INDEX "RoleAssignment_effectiveFrom_effectiveTo_idx" ON "RoleAssignment"("effectiveFrom", "effectiveTo");
CREATE INDEX "RoleAssignment_grantedByUserId_idx" ON "RoleAssignment"("grantedByUserId");
CREATE INDEX "RoleAssignment_revokedByUserId_idx" ON "RoleAssignment"("revokedByUserId");

ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
