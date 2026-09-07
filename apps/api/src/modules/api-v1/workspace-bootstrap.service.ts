import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { AuthService, type AuthSession, type AuthSessionReference } from "../auth/auth.service";
import {
  bookingProviderScope,
  clientIdentityCreateRoles,
  clinicOperatorRoles,
  financeRoles,
  effectiveRoleUnion,
  effectiveRoleUnionForLocation,
  hasAnyRole,
} from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";

const workspaceMemberRoles = new Set([
  ...clinicOperatorRoles,
  ...financeRoles,
  UserRole.InventoryManager,
]);
const inventoryReadRoles = new Set(["Owner", "Admin", "Manager", "InventoryManager"]);
const inventoryWriteRoles = new Set(["Owner", "Admin", "InventoryManager"]);
const staffReadRoles = new Set(["Owner", "Admin", "Manager"]);
const settingsRoles = new Set(["Owner", "Admin"]);

@Injectable()
export class WorkspaceBootstrapService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async getBootstrap(authorization?: AuthSessionReference) {
    const actor = await this.requireWorkspaceMember(authorization);
    const permittedLocationIds = this.permittedLocationIds(actor);

    const [organization, locations] = await Promise.all([
      this.prisma.organization.findFirst({
        where: { id: actor.organizationId, status: "Active" },
        select: {
          id: true,
          name: true,
          businessType: true,
          timezone: true,
          primaryCalendar: true,
        },
      }),
      this.prisma.location.findMany({
        where: {
          organizationId: actor.organizationId,
          isActive: true,
          ...(permittedLocationIds ? { id: { in: permittedLocationIds } } : {}),
        },
        select: {
          id: true,
          name: true,
          timezone: true,
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    ]);

    if (!organization) throw new NotFoundException("Organization not found");

    return {
      user: {
        id: actor.id,
        organizationId: actor.organizationId,
        name: actor.name,
        email: actor.email,
        role: actor.role,
        effectiveRoles: actor.effectiveRoles ?? [actor.role],
        providerId: actor.providerId,
      },
      context: {
        capabilities: {
          canCreateAppointment: locations.some((location) =>
            this.canCreateAppointmentAtLocation(actor, location.id),
          ),
          canCreateClient: hasAnyRole(actor, clientIdentityCreateRoles),
          canAccessInventory: this.hasAnyRoleAnywhere(actor, inventoryReadRoles),
          canAccessStaff: this.hasAnyRoleAnywhere(actor, staffReadRoles),
          canAccessSettings: this.hasOrganizationRole(actor, settingsRoles),
        },
        actor: {
          id: actor.id,
          name: actor.name,
          providerId: actor.providerId ?? null,
          roles: actor.effectiveRoles ?? [actor.role as UserRole],
          roleSource: actor.authorizationRoleSource ?? "legacy_scalar",
        },
        organization: {
          id: organization.id,
          name: organization.name,
          businessType: organization.businessType,
          timezone: organization.timezone,
          primaryCalendar: organization.primaryCalendar === "BS" ? "BS" : "AD",
        },
      },
      locations: locations.map((location) => ({
        id: location.id,
        name: location.name,
        timezone: location.timezone,
        canCreateAppointment: this.canCreateAppointmentAtLocation(
          actor,
          location.id,
        ),
        canManageInventory: effectiveRoleUnionForLocation(actor, location.id).some(
          (role) => inventoryWriteRoles.has(role),
        ),
      })),
    };
  }

  private async requireWorkspaceMember(authorization?: AuthSessionReference): Promise<AuthSession> {
    const actor = await this.auth.requireSession(authorization);
    if (!this.hasAnyRoleAnywhere(actor, workspaceMemberRoles)) {
      throw new ForbiddenException("You are not allowed to access the clinic workspace");
    }
    return actor;
  }

  /**
   * `null` means organization-wide location access. An empty array means the
   * active role assignments grant no clinic-operator access at a location.
   */
  private permittedLocationIds(actor: AuthSession): string[] | null {
    if (!actor.effectiveRoleScopes) return null;

    const workspaceScopes = actor.effectiveRoleScopes.filter((scope) => workspaceMemberRoles.has(scope.role));
    if (workspaceScopes.some((scope) => scope.locationId === null)) return null;

    return [...new Set(workspaceScopes.flatMap((scope) => scope.locationId ? [scope.locationId] : []))];
  }

  private canCreateAppointmentAtLocation(
    actor: AuthSession,
    locationId: string,
  ) {
    try {
      bookingProviderScope(actor, locationId);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private hasAnyRoleAnywhere(actor: AuthSession, roles: ReadonlySet<string>) {
    if (effectiveRoleUnion(actor).some((role) => roles.has(role))) return true;
    return actor.effectiveRoleScopes?.some((scope) => roles.has(scope.role)) ?? false;
  }

  private hasOrganizationRole(actor: AuthSession, roles: ReadonlySet<string>) {
    if (!actor.effectiveRoleScopes) {
      return effectiveRoleUnion(actor).some((role) => roles.has(role));
    }
    return actor.effectiveRoleScopes.some(
      (scope) => scope.locationId === null && roles.has(scope.role),
    );
  }
}
