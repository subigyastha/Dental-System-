import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { AuthService, type AuthSession, type AuthSessionReference } from "../auth/auth.service";
import { assertClinicOperator, clinicOperatorRoles } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { boundedInteger } from "./bounded-integer";

const dashboardCapabilities = [
  "dashboard.read",
  "schedule.read",
  "client.directory.read",
  "follow_up.read",
] as const;

const activeAppointmentStatuses = ["Scheduled", "Confirmed", "CheckedIn", "InProgress", "FollowUpRequired"] as const;
const openFollowUpStatuses = ["Open", "InProgress", "Waiting", "Blocked"] as const;

@Injectable()
export class DashboardBootstrapService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async getBootstrap(limit: number | string, authorization?: AuthSessionReference, now = new Date()) {
    const actor = await this.requireClinicOperator(authorization);
    const pageLimit = boundedInteger(limit, {
      defaultValue: 12,
      field: "limit",
      max: 25,
    });
    const to = new Date(now.getTime() + 24 * 60 * 60_000);
    const roles = actor.effectiveRoles ?? [actor.role as UserRole];
    const roleSource = actor.authorizationRoleSource ?? "legacy_scalar";
    const permittedLocationIds = this.permittedLocationIds(actor);
    const appointmentLocationScope = permittedLocationIds
      ? { locationId: { in: permittedLocationIds } }
      : {};
    const followUpLocationScope = permittedLocationIds
      ? { appointment: { is: { locationId: { in: permittedLocationIds } } } }
      : {};
    const upcomingTake = pageLimit + 1;
    const followUpTake = pageLimit + 1;

    const [organization, upcomingAppointmentCount, dueFollowUpCount, upcoming, followUps] = await Promise.all([
      this.prisma.organization.findFirst({
        where: { id: actor.organizationId },
        select: {
          id: true,
          name: true,
          timezone: true,
          primaryCalendar: true,
          _count: {
            select: {
              customers: { where: { archivedAt: null } },
            },
          },
        },
      }),
      this.prisma.appointment.count({
        where: { organizationId: actor.organizationId, ...appointmentLocationScope, startsAt: { gte: now, lt: to }, status: { in: [...activeAppointmentStatuses] } },
      }),
      this.prisma.followUpTask.count({
        where: { organizationId: actor.organizationId, ...followUpLocationScope, dueAt: { lte: now }, status: { in: [...openFollowUpStatuses] } },
      }),
      this.prisma.appointment.findMany({
        where: { organizationId: actor.organizationId, ...appointmentLocationScope, startsAt: { gte: now, lt: to }, status: { in: [...activeAppointmentStatuses] } },
        select: {
          id: true, startsAt: true, endsAt: true, status: true, priority: true,
          customer: { select: { id: true, fullName: true, patientCode: true } },
          provider: { select: { id: true, displayName: true } },
          location: { select: { id: true, name: true } },
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: upcomingTake,
      }),
      this.prisma.followUpTask.findMany({
        where: { organizationId: actor.organizationId, ...followUpLocationScope, dueAt: { lte: now }, status: { in: [...openFollowUpStatuses] } },
        select: {
          id: true, dueAt: true, status: true, priority: true, type: true, summary: true, nextAction: true,
          customer: { select: { id: true, fullName: true, patientCode: true } },
        },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: followUpTake,
      }),
    ]);

    if (!organization) throw new NotFoundException("Organization not found");

    return {
      context: {
        organization: {
          id: organization.id,
          name: organization.name,
          timezone: organization.timezone,
          primaryCalendar: organization.primaryCalendar === "BS" ? "BS" : "AD",
        },
        actor: { id: actor.id, name: actor.name, roles, roleSource, capabilities: [...dashboardCapabilities] },
      },
      summary: {
        activeClientCount: organization._count.customers,
        appointmentsNext24Hours: upcomingAppointmentCount,
        overdueFollowUpCount: dueFollowUpCount,
        generatedAtIso: now.toISOString(),
      },
      schedule: this.page(upcoming, pageLimit, (appointment) => ({
        id: appointment.id,
        startsAtIso: appointment.startsAt.toISOString(),
        endsAtIso: appointment.endsAt.toISOString(),
        status: appointment.status,
        priority: appointment.priority,
        client: { id: appointment.customer.id, name: appointment.customer.fullName, clientCode: appointment.customer.patientCode },
        provider: { id: appointment.provider.id, name: appointment.provider.displayName },
        location: appointment.location ? { id: appointment.location.id, name: appointment.location.name } : null,
      })),
      followUps: this.page(followUps, pageLimit, (task) => ({
        id: task.id,
        dueAtIso: task.dueAt.toISOString(),
        status: task.status,
        priority: task.priority,
        type: task.type,
        summary: task.summary,
        nextAction: task.nextAction,
        client: { id: task.customer.id, name: task.customer.fullName, clientCode: task.customer.patientCode },
      })),
    };
  }

  private async requireClinicOperator(authorization?: AuthSessionReference): Promise<AuthSession> {
    const actor = await this.auth.requireSession(authorization);
    assertClinicOperator(actor);
    return actor;
  }

  private permittedLocationIds(actor: AuthSession): string[] | null {
    if (!actor.effectiveRoleScopes) return null;
    const operatorScopes = actor.effectiveRoleScopes.filter((scope) =>
      clinicOperatorRoles.has(scope.role),
    );
    if (operatorScopes.some((scope) => scope.locationId === null)) return null;
    return [
      ...new Set(
        operatorScopes.flatMap((scope) =>
          scope.locationId ? [scope.locationId] : [],
        ),
      ),
    ];
  }

  private page<T, R>(items: T[], limit: number, map: (item: T) => R) {
    const hasMore = items.length > limit;
    return {
      items: items.slice(0, limit).map(map),
      page: { limit, count: Math.min(items.length, limit), hasMore },
    };
  }
}
