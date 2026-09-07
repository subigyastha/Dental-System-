import {
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  AuthService,
  type AuthSessionReference,
} from "../auth/auth.service";
import { bookingProviderScope } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BookingBootstrapService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async getBootstrap(
    locationId: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    const providerId = bookingProviderScope(actor, locationId);

    const [organization, location, providers, services] = await Promise.all([
      this.prisma.organization.findFirst({
        where: { id: actor.organizationId, status: "Active" },
        select: {
          id: true,
          timezone: true,
          primaryCalendar: true,
          settings: {
            select: {
              defaultBufferMinutes: true,
              bookingHoldMinutes: true,
            },
          },
        },
      }),
      this.prisma.location.findFirst({
        where: {
          id: locationId,
          organizationId: actor.organizationId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          timezone: true,
        },
      }),
      this.prisma.provider.findMany({
        where: {
          organizationId: actor.organizationId,
          status: { not: "Inactive" },
          ...(providerId ? { id: providerId } : {}),
          OR: [
            { userId: null },
            { user: { is: { status: "Active" } } },
          ],
        },
        select: {
          id: true,
          displayName: true,
          roleLabel: true,
          specialty: true,
          status: true,
          color: true,
          providerServices: {
            where: {
              isActive: true,
              service: { isActive: true },
              OR: [
                { locationId },
                { locationId: null },
              ],
            },
            select: {
              serviceId: true,
              locationId: true,
              customDurationMinutes: true,
            },
            orderBy: [
              { serviceId: "asc" },
              { locationId: "asc" },
            ],
          },
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      }),
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

    if (!organization) {
      throw new NotFoundException("Organization not found");
    }
    if (!location) {
      throw new NotFoundException("Location not found");
    }

    const servicesById = new Map(services.map((service) => [service.id, service]));

    return {
      context: {
        organization: {
          id: organization.id,
          timezone: organization.timezone,
        },
        actor: {
          id: actor.id,
          providerId: actor.providerId ?? null,
        },
        permissions: {
          canCreateAppointment: true,
          providerScope: providerId ? "self" as const : "any" as const,
        },
      },
      bookingDefaults: {
        dateInputCalendar: "AD" as const,
        showBsDateEquivalent: organization.primaryCalendar === "BS",
        slotIntervalMinutes: 15,
        bufferMinutes: organization.settings?.defaultBufferMinutes ?? 10,
        holdMinutes: organization.settings?.bookingHoldMinutes ?? 3,
        defaultLocationId: location.id,
        defaultProviderId: providerId,
      },
      location: {
        id: location.id,
        name: location.name,
        timezone: location.timezone,
      },
      providers: providers.map((provider) => {
        const effectiveAssignments = new Map<
          string,
          (typeof provider.providerServices)[number]
        >();
        for (const assignment of provider.providerServices) {
          const current = effectiveAssignments.get(assignment.serviceId);
          if (!current || assignment.locationId === location.id) {
            effectiveAssignments.set(assignment.serviceId, assignment);
          }
        }
        const supportedServices = effectiveAssignments.size
          ? [...effectiveAssignments.values()]
              .map((assignment) => {
                const service = servicesById.get(assignment.serviceId);
                return service
                  ? {
                      serviceId: service.id,
                      durationMinutes:
                        assignment.customDurationMinutes ??
                        service.durationMinutes,
                      bufferMinutes: service.bufferMinutes,
                    }
                  : null;
              })
              .filter((service) => service !== null)
          : services.map((service) => ({
              serviceId: service.id,
              durationMinutes: service.durationMinutes,
              bufferMinutes: service.bufferMinutes,
            }));

        return {
          id: provider.id,
          name: provider.displayName,
          roleLabel: provider.roleLabel,
          specialty: provider.specialty,
          status: provider.status,
          color: provider.color,
          serviceOptions: supportedServices,
        };
      }),
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        category: service.category,
        durationMinutes: service.durationMinutes,
        bufferMinutes: service.bufferMinutes,
      })),
    };
  }
}
