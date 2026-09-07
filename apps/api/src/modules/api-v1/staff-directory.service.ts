import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type UserRole } from "@prisma/client";

import { mapStaffToClient } from "../../lib/map-staff";
import {
  AuthService,
  type AuthSession,
  type AuthSessionReference,
} from "../auth/auth.service";
import { effectiveRoleUnion } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { boundedInteger } from "./bounded-integer";
import type { StaffDirectoryQueryDto } from "./dto/staff-directory.dto";

const VIEW_ROLES = new Set(["Owner", "Admin", "Manager"]);
const MANAGE_ROLES = new Set(["Owner", "Admin"]);

const activeMembership = (organizationId: string, now: Date) => ({
  organizationId,
  status: "Active" as const,
  revokedAt: null,
  effectiveFrom: { lte: now },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
});

const activeAssignment = (now: Date) => ({
  revokedAt: null,
  effectiveFrom: { lte: now },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
});

@Injectable()
export class StaffDirectoryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async list(
    query: StaffDirectoryQueryDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    const page = boundedInteger(query.page, {
      defaultValue: 1,
      field: "page",
      max: 10_000,
    });
    const limit = boundedInteger(query.limit, {
      defaultValue: 25,
      field: "limit",
      max: 100,
      min: 10,
    });
    const permittedLocationIds = this.staffLocationScope(actor);
    if (
      query.locationId &&
      permittedLocationIds !== null &&
      !permittedLocationIds.includes(query.locationId)
    ) {
      throw new ForbiddenException("You cannot view staff for this location");
    }
    if (query.locationId) {
      const location = await this.prisma.location.findFirst({
        where: {
          id: query.locationId,
          organizationId: actor.organizationId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!location) throw new NotFoundException("Location not found");
    }

    const now = new Date();
    const scopeWhere = this.scopeWhere(actor.organizationId, permittedLocationIds, now);
    const search = query.query?.trim();
    const filters: Prisma.UserWhereInput = {
      ...scopeWhere,
      ...(query.status ? { status: query.status } : {}),
      ...(query.role
        ? {
            OR: [
              { role: query.role as UserRole },
              {
                memberships: {
                  some: {
                    ...activeMembership(actor.organizationId, now),
                    roleAssignments: {
                      some: {
                        ...activeAssignment(now),
                        role: query.role as UserRole,
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
      ...(query.locationId
        ? {
            memberships: {
              some: {
                ...activeMembership(actor.organizationId, now),
                roleAssignments: {
                  some: {
                    ...activeAssignment(now),
                    OR: [{ locationId: null }, { locationId: query.locationId }],
                  },
                },
              },
            },
          }
        : {}),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { email: { contains: search, mode: "insensitive" } },
                  { phone: { contains: search, mode: "insensitive" } },
                  { staffLabel: { contains: search, mode: "insensitive" } },
                  { department: { contains: search, mode: "insensitive" } },
                  { employeeCode: { contains: search, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
    };
    const orderBy = this.orderBy(query.sort, query.direction);
    const skip = (page - 1) * limit;

    const [rows, total, statusCounts, schedulableCount] = await Promise.all([
      this.prisma.user.findMany({
        where: filters,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          staffLabel: true,
          department: true,
          employeeCode: true,
          status: true,
          isSchedulable: true,
          lastLoginAt: true,
          provider: {
            select: { id: true, displayName: true, specialty: true, color: true, status: true },
          },
          memberships: {
            where: activeMembership(actor.organizationId, now),
            select: {
              roleAssignments: {
                where: activeAssignment(now),
                select: {
                  id: true,
                  role: true,
                  locationId: true,
                  location: { select: { id: true, name: true } },
                },
                orderBy: [{ role: "asc" }, { locationId: "asc" }],
              },
            },
            take: 1,
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where: filters }),
      this.prisma.user.groupBy({
        by: ["status"],
        where: scopeWhere,
        _count: { _all: true },
      }),
      this.prisma.user.count({ where: { ...scopeWhere, isSchedulable: true } }),
    ]);

    const countByStatus = new Map(
      statusCounts.map((entry) => [entry.status, entry._count._all]),
    );
    return {
      capabilities: {
        canManageStaff: this.hasOrganizationRole(actor, MANAGE_ROLES),
        canManageAccess: this.hasOrganizationRole(actor, MANAGE_ROLES),
      },
      summary: {
        active: countByStatus.get("Active") ?? 0,
        invited: countByStatus.get("Invited") ?? 0,
        inactive: countByStatus.get("Inactive") ?? 0,
        suspended: countByStatus.get("Suspended") ?? 0,
        schedulable: schedulableCount,
      },
      pagination: {
        page,
        limit,
        total,
        pageCount: Math.max(1, Math.ceil(total / limit)),
      },
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        primaryRole: row.role,
        staffLabel: row.staffLabel ?? row.role,
        department: row.department,
        employeeCode: row.employeeCode,
        status: row.status,
        isSchedulable: row.isSchedulable,
        lastLoginAtIso: row.lastLoginAt?.toISOString() ?? null,
        provider: row.provider,
        assignments: row.memberships[0]?.roleAssignments ?? [],
      })),
    };
  }

  async detail(id: string, authorization?: AuthSessionReference) {
    const actor = await this.auth.requireSession(authorization);
    if (!this.hasOrganizationRole(actor, MANAGE_ROLES)) {
      throw new ForbiddenException("You are not allowed to manage clinic staff");
    }
    const permittedLocationIds = this.staffLocationScope(actor);
    const now = new Date();
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        ...this.scopeWhere(actor.organizationId, permittedLocationIds, now),
      },
      include: {
        provider: {
          include: {
            availability: { orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }] },
            recurringBlocks: { orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }] },
            blockedTimes: { orderBy: { startsAt: "asc" } },
            providerServices: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException("Staff account not found");
    return { item: mapStaffToClient(user) };
  }

  private staffLocationScope(actor: AuthSession): string[] | null {
    if (!actor.effectiveRoleScopes) {
      if (effectiveRoleUnion(actor).some((role) => VIEW_ROLES.has(role))) return null;
      throw new ForbiddenException("You are not allowed to view clinic staff");
    }
    if (
      actor.effectiveRoleScopes.some(
        (scope) => scope.locationId === null && VIEW_ROLES.has(scope.role),
      )
    ) {
      return null;
    }
    const ids = [
      ...new Set(
        actor.effectiveRoleScopes
          .filter((scope) => scope.locationId && VIEW_ROLES.has(scope.role))
          .map((scope) => scope.locationId!),
      ),
    ];
    if (!ids.length) throw new ForbiddenException("You are not allowed to view clinic staff");
    return ids;
  }

  private scopeWhere(
    organizationId: string,
    permittedLocationIds: string[] | null,
    now: Date,
  ): Prisma.UserWhereInput {
    if (permittedLocationIds === null) return { organizationId };
    return {
      organizationId,
      memberships: {
        some: {
          ...activeMembership(organizationId, now),
          roleAssignments: {
            some: {
              ...activeAssignment(now),
              OR: [
                { locationId: null },
                { locationId: { in: permittedLocationIds } },
              ],
            },
          },
        },
      },
    };
  }

  private hasOrganizationRole(actor: AuthSession, roles: ReadonlySet<string>) {
    if (!actor.effectiveRoleScopes) {
      return effectiveRoleUnion(actor).some((role) => roles.has(role));
    }
    return actor.effectiveRoleScopes.some(
      (scope) => scope.locationId === null && roles.has(scope.role),
    );
  }

  private orderBy(
    sort: StaffDirectoryQueryDto["sort"],
    direction: StaffDirectoryQueryDto["direction"],
  ): Prisma.UserOrderByWithRelationInput[] {
    const secondary: Prisma.UserOrderByWithRelationInput = { id: "asc" };
    if (sort === "role") return [{ role: direction }, { name: "asc" }, secondary];
    if (sort === "status") return [{ status: direction }, { name: "asc" }, secondary];
    if (sort === "lastLogin") return [{ lastLoginAt: { sort: direction, nulls: "last" } }, { name: "asc" }, secondary];
    return [{ name: direction }, secondary];
  }
}
