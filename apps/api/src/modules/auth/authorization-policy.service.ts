import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export const LEGACY_ROLE_DUAL_READ_ENV = "ROLE_ASSIGNMENT_DUAL_READ";
export const platformOnlyRoles = new Set<UserRole>([UserRole.SuperAdmin]);
export const nonAssignableClinicRoles = new Set<UserRole>([UserRole.SuperAdmin, UserRole.Client]);
export const ownerAdminExpandedRoles = new Set<UserRole>([
  UserRole.Owner,
  UserRole.Admin,
  UserRole.Manager,
  UserRole.Receptionist,
  UserRole.Scheduler,
  UserRole.Provider,
  UserRole.Assistant,
  UserRole.Finance,
  UserRole.InventoryManager,
]);

export type RoleAssignmentView = {
  role: UserRole;
  locationId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  revokedAt: Date | null;
};

export type AuthorizationContext = {
  organizationId: string;
  membershipId?: string;
  roles: UserRole[];
  roleScopes: Array<{ role: UserRole; locationId: string | null }>;
  source: "assignments" | "legacy-quarantined" | "none";
};

export type AssignRoleInput = {
  organizationId: string;
  userId: string;
  role: UserRole;
  actorUserId: string;
  reason: string;
  locationId?: string;
  effectiveFrom?: Date;
  effectiveTo?: Date;
};

export function isEffectiveAt(
  record: Pick<RoleAssignmentView, "effectiveFrom" | "effectiveTo" | "revokedAt">,
  at: Date,
) {
  return record.effectiveFrom <= at && !record.revokedAt && (!record.effectiveTo || record.effectiveTo > at);
}

export function effectiveRoles(
  assignments: RoleAssignmentView[],
  at: Date,
  locationId?: string,
) {
  const direct = assignments
    .filter((assignment) => isEffectiveAt(assignment, at))
    // Omitting a target location means organization scope: location-only
    // assignments must never leak into that broader authorization decision.
    .filter((assignment) => locationId ? !assignment.locationId || assignment.locationId === locationId : !assignment.locationId)
    .map((assignment) => assignment.role);
  return expandOwnerAdminRoles(direct);
}

export function effectiveRoleScopes(assignments: RoleAssignmentView[], at: Date) {
  return assignments
    .filter((assignment) => isEffectiveAt(assignment, at))
    .flatMap((assignment) => expandOwnerAdminRoles([assignment.role]).map((role) => ({ role, locationId: assignment.locationId })));
}

export function expandOwnerAdminRoles(roles: UserRole[]) {
  const expanded = new Set(roles);
  if (roles.includes(UserRole.Owner) || roles.includes(UserRole.Admin)) {
    ownerAdminExpandedRoles.forEach((role) => expanded.add(role));
  }
  return [...expanded];
}

@Injectable()
export class AuthorizationPolicyService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async resolveContext(
    userId: string,
    organizationId: string,
    options: { locationId?: string; at?: Date } = {},
  ): Promise<AuthorizationContext> {
    const at = options.at ?? new Date();
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { roleAssignments: true },
    });

    if (membership) {
      const membershipIsActive =
        membership.status === "Active" &&
        membership.effectiveFrom <= at &&
        !membership.revokedAt &&
        (!membership.effectiveTo || membership.effectiveTo > at);
      return {
        organizationId,
        membershipId: membership.id,
        roles: membershipIsActive
          ? effectiveRoles(membership.roleAssignments, at, options.locationId)
          : [],
        roleScopes: membershipIsActive ? effectiveRoleScopes(membership.roleAssignments, at) : [],
        source: "assignments",
      };
    }

    if (!this.isLegacyDualReadEnabled()) {
      return { organizationId, roles: [], roleScopes: [], source: "none" };
    }

    const legacyUser = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { role: true },
    });
    if (!legacyUser || nonAssignableClinicRoles.has(legacyUser.role)) {
      return { organizationId, roles: [], roleScopes: [], source: "none" };
    }
    return {
      organizationId,
      roles: expandOwnerAdminRoles([legacyUser.role]),
      roleScopes: expandOwnerAdminRoles([legacyUser.role]).map((role) => ({ role, locationId: null })),
      source: "legacy-quarantined",
    };
  }

  async assignRole(input: AssignRoleInput) {
    if (!input.actorUserId || !input.reason.trim()) {
      throw new BadRequestException("Role grants require an actor and a reason");
    }
    if (nonAssignableClinicRoles.has(input.role)) {
      throw new BadRequestException("Platform and client roles cannot be assigned to an organization membership");
    }
    if (input.effectiveTo && input.effectiveFrom && input.effectiveTo <= input.effectiveFrom) {
      throw new BadRequestException("Role effective end must be after its effective start");
    }
    if (input.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: input.locationId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!location) {
        throw new NotFoundException("Location is not in the organization");
      }
    }

    const membership = await this.prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        effectiveFrom: input.effectiveFrom,
        grantedByUserId: input.actorUserId,
        grantReason: input.reason.trim(),
      },
      update: {},
    });
    const existing = await this.prisma.roleAssignment.findFirst({
      where: {
        membershipId: membership.id,
        role: input.role,
        locationId: input.locationId ?? null,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException("An active equivalent role assignment already exists");
    }
    return this.prisma.roleAssignment.create({
      data: {
        membershipId: membership.id,
        role: input.role,
        locationId: input.locationId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        grantedByUserId: input.actorUserId,
        grantReason: input.reason.trim(),
      },
    });
  }

  async revokeRoleAssignment(assignmentId: string, actorUserId: string, reason: string) {
    if (!actorUserId || !reason.trim()) {
      throw new BadRequestException("Role revocation requires an actor and a reason");
    }
    return this.prisma.roleAssignment.update({
      where: { id: assignmentId },
      data: {
        revokedAt: new Date(),
        revokedByUserId: actorUserId,
        revokedReason: reason.trim(),
      },
    });
  }

  async revokeMembership(membershipId: string, actorUserId: string, reason: string) {
    if (!actorUserId || !reason.trim()) {
      throw new BadRequestException("Membership revocation requires an actor and a reason");
    }
    return this.prisma.organizationMembership.update({
      where: { id: membershipId },
      data: {
        status: "Revoked",
        revokedAt: new Date(),
        revokedByUserId: actorUserId,
        revokedReason: reason.trim(),
      },
    });
  }

  /** Explicit migration/import exception: legacy data has no reliable grantor. */
  async backfillLegacyRoleForMigration(userId: string, organizationId: string) {
    const legacyUser = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { id: true, role: true },
    });
    if (!legacyUser) {
      throw new NotFoundException("Legacy user membership was not found");
    }
    if (nonAssignableClinicRoles.has(legacyUser.role)) {
      return { created: false, reason: "legacy_role_is_not_a_clinic_assignment" };
    }
    const membership = await this.prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { organizationId, userId, grantReason: "legacy_scalar_role_backfill" },
      update: {},
    });
    const existing = await this.prisma.roleAssignment.findFirst({
      where: { membershipId: membership.id, role: legacyUser.role, locationId: null, revokedAt: null },
      select: { id: true },
    });
    if (existing) {
      return { created: false, membershipId: membership.id, assignmentId: existing.id };
    }
    const assignment = await this.prisma.roleAssignment.create({
      data: {
        membershipId: membership.id,
        role: legacyUser.role,
        grantReason: "legacy_scalar_role_backfill",
      },
    });
    return { created: true, membershipId: membership.id, assignmentId: assignment.id };
  }

  private isLegacyDualReadEnabled() {
    return process.env[LEGACY_ROLE_DUAL_READ_ENV] === "true";
  }
}
