import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { AuthService, type AuthSession, type AuthSessionReference } from "./auth.service";
import { AssignRoleDto } from "./dto/assign-role.dto";
import { AuthorizationPolicyService } from "./authorization-policy.service";
import { hasAnyRole, hasRole } from "./authz";

@Injectable()
export class RoleGovernanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthorizationPolicyService) private readonly policy: AuthorizationPolicyService,
  ) {}

  async list(authorization?: AuthSessionReference) {
    const actor = await this.requireOwnerOrAdmin(authorization);
    return this.prisma.organizationMembership.findMany({
      where: { organizationId: actor.organizationId },
      include: {
        user: { select: { id: true, name: true, email: true, status: true } },
        roleAssignments: { include: { location: { select: { id: true, name: true } } } },
      },
      orderBy: [{ createdAt: "asc" }],
    });
  }

  async assign(dto: AssignRoleDto, authorization?: AuthSessionReference) {
    const actor = await this.requireOwnerOrAdmin(authorization);
    this.assertNoSelfManagement(actor, dto.userId);
    this.assertRoleManageableBy(actor, dto.role);
    const target = await this.prisma.user.findFirst({
      where: { id: dto.userId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException("Target user is not in the organization");

    const membershipBefore = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: actor.organizationId, userId: dto.userId } },
      select: { id: true },
    });
    const assignment = await this.policy.assignRole({
      organizationId: actor.organizationId,
      userId: dto.userId,
      role: dto.role,
      actorUserId: actor.id,
      reason: dto.reason,
      locationId: dto.locationId,
      effectiveFrom: dto.effectiveFromIso ? new Date(dto.effectiveFromIso) : undefined,
      effectiveTo: dto.effectiveToIso ? new Date(dto.effectiveToIso) : undefined,
    });
    await this.prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        entityType: "role_assignment",
        entityId: assignment.id,
        action: "granted",
        newValue: { userId: dto.userId, role: dto.role, locationId: dto.locationId ?? null, reason: dto.reason },
        description: "Organization role granted",
      },
    });
    if (!membershipBefore) {
      await this.prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "organization_membership",
          entityId: assignment.membershipId,
          action: "created",
          newValue: { userId: dto.userId, reason: dto.reason },
          description: "Organization membership created while granting a role",
        },
      });
    }
    return assignment;
  }

  async revokeRoleAssignment(assignmentId: string, reason: string, authorization?: AuthSessionReference) {
    const actor = await this.requireOwnerOrAdmin(authorization);
    const assignment = await this.prisma.roleAssignment.findFirst({
      where: { id: assignmentId, membership: { organizationId: actor.organizationId } },
      include: { membership: { select: { userId: true, organizationId: true } } },
    });
    if (!assignment) throw new NotFoundException("Role assignment not found");
    this.assertNoSelfManagement(actor, assignment.membership.userId);
    this.assertRoleManageableBy(actor, assignment.role);
    const revoked = await this.policy.revokeRoleAssignment(assignment.id, actor.id, reason);
    await this.prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        entityType: "role_assignment",
        entityId: assignment.id,
        action: "revoked",
        oldValue: { role: assignment.role, locationId: assignment.locationId, userId: assignment.membership.userId },
        newValue: { reason },
        description: "Organization role revoked",
      },
    });
    return revoked;
  }

  async revokeMembership(membershipId: string, reason: string, authorization?: AuthSessionReference) {
    const actor = await this.requireOwnerOrAdmin(authorization);
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId: actor.organizationId },
      select: { id: true, userId: true, status: true },
    });
    if (!membership) throw new NotFoundException("Organization membership not found");
    this.assertNoSelfManagement(actor, membership.userId);
    const revoked = await this.policy.revokeMembership(membership.id, actor.id, reason);
    await this.prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        entityType: "organization_membership",
        entityId: membership.id,
        action: "revoked",
        oldValue: { userId: membership.userId, status: membership.status },
        newValue: { reason },
        description: "Organization membership revoked",
      },
    });
    return revoked;
  }

  private async requireOwnerOrAdmin(authorization?: AuthSessionReference) {
    const actor = await this.auth.requireSession(authorization);
    if (!hasAnyRole(actor, new Set([UserRole.Owner, UserRole.Admin]))) {
      throw new ForbiddenException("Only an Owner or Admin can govern organization roles");
    }
    if (!actor.organizationId) throw new ForbiddenException("Platform users cannot govern clinic roles");
    return actor;
  }

  private assertNoSelfManagement(actor: AuthSession, targetUserId: string) {
    if (actor.id === targetUserId) {
      throw new ForbiddenException("Users cannot change their own role assignments or membership");
    }
  }

  private assertRoleManageableBy(actor: AuthSession, role: UserRole) {
    if (role === UserRole.Owner && !hasRole(actor, UserRole.Owner)) {
      throw new ForbiddenException("Only an Owner can manage Owner assignments");
    }
  }
}
