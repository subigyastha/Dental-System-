import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";

import { mapProviderStatus, mapProviderToClient } from "../../lib/map-provider";
import {
  AuthService,
  type AuthSession,
  type AuthSessionReference,
} from "../auth/auth.service";
import { clinicOperatorRoles, hasAnyRole } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ScheduleBootstrapService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async getBootstrap(
    authorization?: AuthSessionReference,
    detail: "summary" | "full" = "full",
  ) {
    if (detail !== "summary" && detail !== "full") {
      throw new BadRequestException("Schedule bootstrap detail must be summary or full");
    }
    const actor = await this.auth.requireSession(authorization);
    if (!hasAnyRole(actor, clinicOperatorRoles)) {
      throw new ForbiddenException("You are not allowed to view clinic schedules");
    }

    const locationIds = this.permittedLocationIds(actor);
    const locationFilter = locationIds
      ? { OR: [{ locationId: null }, { locationId: { in: locationIds } }] }
      : {};

    const providerWhere = {
      organizationId: actor.organizationId,
      status: { not: "Inactive" as const },
      OR: [{ userId: null }, { user: { is: { status: "Active" as const } } }],
    };
    const providerOrderBy = [{ displayName: "asc" as const }, { id: "asc" as const }];
    const providerRequest = detail === "summary"
      ? Promise.all([
          this.prisma.provider.findMany({
            where: providerWhere,
            select: {
              id: true,
              userId: true,
              displayName: true,
              roleLabel: true,
              specialty: true,
              status: true,
              color: true,
            },
            orderBy: providerOrderBy,
          }),
          this.prisma.providerService.findMany({
            where: {
              isActive: true,
              service: { isActive: true },
              provider: { organizationId: actor.organizationId },
              ...locationFilter,
            },
            select: { providerId: true, serviceId: true },
            orderBy: [{ providerId: "asc" }, { serviceId: "asc" }],
          }),
        ]).then(([providers, providerServices]) => {
          const serviceIdsByProvider = new Map<string, string[]>();
          for (const providerService of providerServices) {
            const serviceIds = serviceIdsByProvider.get(providerService.providerId) ?? [];
            serviceIds.push(providerService.serviceId);
            serviceIdsByProvider.set(providerService.providerId, serviceIds);
          }
          return providers.map((provider) => ({
            id: provider.id,
            userId: provider.userId ?? undefined,
            name: provider.displayName,
            roleLabel: provider.roleLabel,
            specialty: provider.specialty ?? "General service",
            color: provider.color,
            capacityMinutes: 420,
            bookedMinutes: 0,
            status: mapProviderStatus(provider.status),
            availability: [],
            recurringBlocks: [],
            blockedTimes: [],
            serviceIds: serviceIdsByProvider.get(provider.id) ?? [],
          }));
        })
      : this.prisma.provider.findMany({
        where: {
          ...providerWhere,
        },
        include: {
          availability: {
            where: locationFilter,
            orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }],
          },
          recurringBlocks: {
            where: locationFilter,
            orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }],
          },
          blockedTimes: {
            where: locationFilter,
            orderBy: { startsAt: "asc" },
          },
          providerServices: {
            where: {
              isActive: true,
              service: { isActive: true },
              ...locationFilter,
            },
            orderBy: [{ serviceId: "asc" }, { locationId: "asc" }],
          },
        },
        orderBy: providerOrderBy,
      }).then((providers) => providers.map(mapProviderToClient));

    const [providers, services] = await Promise.all([
      providerRequest,
      this.prisma.service.findMany({
        where: {
          organizationId: actor.organizationId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          category: true,
          durationMinutes: true,
          bufferMinutes: true,
        },
        orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }],
      }),
    ]);

    return {
      context: {
        organizationId: actor.organizationId,
        generatedAtIso: new Date().toISOString(),
      },
      providers,
      services,
    };
  }

  /** `null` means the actor has organization-wide operator access. */
  private permittedLocationIds(actor: AuthSession): string[] | null {
    if (!actor.effectiveRoleScopes) return null;
    const scopes = actor.effectiveRoleScopes.filter((scope) =>
      clinicOperatorRoles.has(scope.role),
    );
    if (scopes.some((scope) => scope.locationId === null)) return null;
    return [...new Set(scopes.flatMap((scope) => scope.locationId ? [scope.locationId] : []))];
  }
}
