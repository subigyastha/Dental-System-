import { Inject, Injectable } from "@nestjs/common";

import { mapProviderToClient } from "../../lib/map-provider";
import { AuthService } from "../auth/auth.service";
import { assertClinicOperator } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class OperationalDataService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async getOperationalData(authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session);
    const organization = await this.prisma.organization.findUnique({
      where: { id: session.organizationId },
      include: {
        settings: true,
        providers: {
          include: {
            availability: {
              orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }],
            },
            recurringBlocks: {
              orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }],
            },
            blockedTimes: {
              orderBy: { startsAt: "asc" },
            },
            providerServices: true,
          },
        },
        users: {
          select: {
            id: true,
            organizationId: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            role: true,
            provider: {
              include: {
                availability: {
                  orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }],
                },
                recurringBlocks: {
                  orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }],
                },
                blockedTimes: {
                  orderBy: { startsAt: "asc" },
                },
                providerServices: true,
              },
            },
          },
          orderBy: [{ role: "asc" }, { name: "asc" }],
        },
        locations: true,
        customers: {
          include: {
            dentalChart: true,
          },
        },
        services: true,
        appointments: {
          include: {
            resource: true,
            services: true,
            session: {
              include: {
                dentalChartRevision: true,
              },
            },
          },
          orderBy: { startsAt: "asc" },
        },
        followUpTasks: true,
      },
    });

    if (!organization) {
      return null;
    }

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        businessType: organization.businessType,
        email: organization.email ?? undefined,
        phone: organization.phone ?? undefined,
        address: organization.address ?? undefined,
        timezone: organization.timezone,
        primaryCalendar: organization.primaryCalendar === "AD" ? "AD" : "BS",
        businessDayStartsAt: organization.settings?.businessDayStartsAt,
        businessDayEndsAt: organization.settings?.businessDayEndsAt,
        defaultBufferMinutes: organization.settings?.defaultBufferMinutes,
        reminderLeadMinutes: organization.settings?.reminderLeadMinutes,
        allowOverlaps: organization.settings?.allowOverlaps,
      },
      providers: organization.providers.map((provider) =>
        mapProviderToClient(provider),
      ),
      staff: organization.users.map((user) => ({
        id: user.id,
        organizationId: user.organizationId ?? organization.id,
        providerId: user.provider?.id ?? undefined,
        name: user.name,
        email: user.email,
        phone: user.phone ?? undefined,
        role: user.role,
        staffLabel: user.provider?.roleLabel ?? user.role,
        status: user.status,
        isSchedulable: Boolean(user.provider),
        provider: user.provider ? mapProviderToClient(user.provider) : undefined,
      })),
      locations: organization.locations.map((location) => ({
        id: location.id,
        organizationId: location.organizationId,
        name: location.name,
        address: location.address ?? undefined,
        phone: location.phone ?? undefined,
        timezone: location.timezone,
        isActive: location.isActive,
      })),
      customers: organization.customers.map((customer) => ({
        id: customer.id,
        name: customer.fullName,
        patientCode: customer.patientCode ?? `PT-${customer.id.slice(-4).toUpperCase()}`,
        phone: customer.phone,
        email: customer.email ?? undefined,
        age: customer.dateOfBirth ? this.getAge(customer.dateOfBirth) : 0,
        gender: customer.gender ?? undefined,
        address: customer.address ?? undefined,
        dateOfBirthIso: customer.dateOfBirth?.toISOString(),
        emergencyContactName: customer.emergencyContactName ?? undefined,
        emergencyContactPhone: customer.emergencyContactPhone ?? undefined,
        allergies: customer.allergies ?? undefined,
        medicalNotes: customer.medicalNotes ?? undefined,
        status:
          customer.riskLabel === "High priority" ||
          customer.riskLabel === "Needs attention"
            ? "Monitoring"
            : "Active",
        risk:
          customer.riskLabel === "High priority"
            ? "High priority"
            : customer.riskLabel === "Needs attention"
              ? "Needs attention"
              : "Routine",
        lastVisitIso: (customer.lastVisitAt ?? customer.updatedAt).toISOString(),
        dentalChart: customer.dentalChart
          ? {
              id: customer.dentalChart.id,
              chartData: customer.dentalChart.chartData,
              version: customer.dentalChart.version,
              updatedAtIso: customer.dentalChart.updatedAt.toISOString(),
            }
          : undefined,
      })),
      services: organization.services.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        bufferMinutes: service.bufferMinutes,
        category: service.category,
      })),
      appointments: organization.appointments.map((appointment) => ({
        id: appointment.id,
        organizationId: appointment.organizationId,
        customerId: appointment.customerId,
        providerId: appointment.providerId,
        serviceIds: appointment.services.map((item) => item.serviceId),
        startsAtIso: appointment.startsAt.toISOString(),
        durationMinutes: appointment.durationMinutes,
        bufferMinutes: appointment.bufferMinutes,
        status: appointment.status,
        priority: appointment.priority,
        chair: appointment.resource?.name ?? "Unassigned resource",
        notes: appointment.notes ?? "",
        communicationState: this.normalizeCommunicationState(
          appointment.communicationState,
        ),
      })),
      followUps: organization.followUpTasks.map((task) => ({
        id: task.id,
        appointmentId: task.appointmentId ?? undefined,
        customerId: task.customerId,
        ownerId: task.ownerId ?? "",
        type: task.type,
        status: task.status,
        priority: task.priority,
        dueIso: task.dueAt.toISOString(),
        summary: task.summary,
        nextAction: task.nextAction,
      })),
      visitReports: organization.appointments
        .filter((appointment) => appointment.session)
        .map((appointment) => ({
          id: appointment.session!.id,
          appointmentId: appointment.id,
          customerId: appointment.customerId,
          providerId: appointment.providerId,
          serviceId: appointment.session!.serviceId,
          appointmentStartsAtIso: appointment.startsAt.toISOString(),
          createdAtIso: appointment.session!.createdAt.toISOString(),
          updatedAtIso: appointment.session!.updatedAt.toISOString(),
          visitSummary: appointment.session!.visitSummary ?? "",
          symptoms: appointment.session!.symptoms ?? undefined,
          clinicalNotes: appointment.session!.clinicalNotes ?? undefined,
          doctorNotes: appointment.session!.doctorNotes ?? undefined,
          followUpRequired: appointment.session!.followUpRequired,
          followUpDateIso: appointment.session!.followUpDate?.toISOString(),
          dentalChartUpdated: appointment.session!.dentalChartUpdated,
          chartNote: appointment.session!.chartNote ?? undefined,
          dentalChartRevision: appointment.session!.dentalChartRevision
            ? {
                id: appointment.session!.dentalChartRevision.id,
                chartData: appointment.session!.dentalChartRevision.chartData,
                note: appointment.session!.dentalChartRevision.note ?? undefined,
                createdAtIso: appointment.session!.dentalChartRevision.createdAt.toISOString(),
              }
            : undefined,
        }))
        .sort(
          (a, b) =>
            new Date(b.appointmentStartsAtIso).getTime() -
            new Date(a.appointmentStartsAtIso).getTime(),
        ),
      databaseConnected: true,
    };
  }

  private normalizeCommunicationState(value: string) {
    if (
      value === "Confirmed by phone" ||
      value === "SMS sent" ||
      value === "Needs call"
    ) {
      return value;
    }

    return "Unconfirmed";
  }

  private getAge(date: Date) {
    const today = new Date("2026-05-06T00:00:00+05:45");
    let age = today.getFullYear() - date.getFullYear();
    const monthDelta = today.getMonth() - date.getMonth();
    if (
      monthDelta < 0 ||
      (monthDelta === 0 && today.getDate() < date.getDate())
    ) {
      age -= 1;
    }
    return age;
  }
}
