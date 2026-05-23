import type {
  Appointment,
  Customer,
  FollowUpTask,
  Location,
  Organization,
  Provider,
  Service,
  StaffMember,
  VisitReport,
} from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import {
  appointments as seedAppointments,
  customers as seedCustomers,
  followUps as seedFollowUps,
  organization as seedOrganization,
  providers as seedProviders,
  services as seedServices,
  staff as seedStaff,
  visitReports as seedVisitReports,
} from "@/lib/seed-data";

export type OperationalData = {
  organization: Organization;
  providers: Provider[];
  staff: StaffMember[];
  customers: Customer[];
  services: Service[];
  locations: Location[];
  appointments: Appointment[];
  followUps: FollowUpTask[];
  visitReports: VisitReport[];
  databaseConnected: boolean;
};

const configuredNestApiBase =
  process.env.NEST_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000/api";

export async function getOperationalData(): Promise<OperationalData> {
  const nestData = await getNestOperationalData();
  if (nestData) {
    return nestData;
  }

  if (!process.env.DATABASE_URL) {
    return fallbackData(false);
  }

  try {
    const organization = await prisma.organization.findFirst({
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
      return fallbackData(true);
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
      providers: organization.providers.map((provider) => ({
        id: provider.id,
        userId: provider.userId ?? undefined,
        name: provider.displayName,
        roleLabel: provider.roleLabel,
        specialty: provider.specialty ?? "General service",
        color: provider.color,
        capacityMinutes: 420,
        bookedMinutes: 0,
        status:
          provider.status === "Busy" ||
          provider.status === "Away" ||
          provider.status === "Inactive"
            ? provider.status
            : "Available",
        availability: provider.availability.map((item) => ({
          id: item.id,
          providerId: item.providerId,
          locationId: item.locationId ?? undefined,
          dayOfWeek: item.dayOfWeek,
          startsAtLocal: item.startsAtLocal,
          endsAtLocal: item.endsAtLocal,
          slotDurationMinutes: item.slotDurationMinutes,
          bufferMinutes: item.bufferMinutes,
          isActive: item.isActive,
        })),
        recurringBlocks: provider.recurringBlocks.map((item) => ({
          id: item.id,
          providerId: item.providerId,
          locationId: item.locationId ?? undefined,
          dayOfWeek: item.dayOfWeek,
          startsAtLocal: item.startsAtLocal,
          endsAtLocal: item.endsAtLocal,
          reason: item.reason,
          isActive: item.isActive,
        })),
        blockedTimes: provider.blockedTimes.map((item) => ({
          id: item.id,
          providerId: item.providerId ?? undefined,
          locationId: item.locationId ?? undefined,
          startsAtIso: item.startsAt.toISOString(),
          endsAtIso: item.endsAt.toISOString(),
          reason: item.reason,
        })),
        serviceIds: provider.providerServices
          .filter((item) => item.isActive)
          .map((item) => item.serviceId),
      })),
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
        provider: user.provider
          ? {
              id: user.provider.id,
              userId: user.provider.userId ?? undefined,
              name: user.provider.displayName,
              roleLabel: user.provider.roleLabel,
              specialty: user.provider.specialty ?? "General service",
              color: user.provider.color,
              capacityMinutes: 420,
              bookedMinutes: 0,
              status:
                user.provider.status === "Busy" ||
                user.provider.status === "Away" ||
                user.provider.status === "Inactive"
                  ? user.provider.status
                  : "Available",
              availability: user.provider.availability.map((item) => ({
                id: item.id,
                providerId: item.providerId,
                locationId: item.locationId ?? undefined,
                dayOfWeek: item.dayOfWeek,
                startsAtLocal: item.startsAtLocal,
                endsAtLocal: item.endsAtLocal,
                slotDurationMinutes: item.slotDurationMinutes,
                bufferMinutes: item.bufferMinutes,
                isActive: item.isActive,
              })),
              recurringBlocks: user.provider.recurringBlocks.map((item) => ({
                id: item.id,
                providerId: item.providerId,
                locationId: item.locationId ?? undefined,
                dayOfWeek: item.dayOfWeek,
                startsAtLocal: item.startsAtLocal,
                endsAtLocal: item.endsAtLocal,
                reason: item.reason,
                isActive: item.isActive,
              })),
              blockedTimes: user.provider.blockedTimes.map((item) => ({
                id: item.id,
                providerId: item.providerId ?? undefined,
                locationId: item.locationId ?? undefined,
                startsAtIso: item.startsAt.toISOString(),
                endsAtIso: item.endsAt.toISOString(),
                reason: item.reason,
              })),
              serviceIds: user.provider.providerServices
                .filter((item) => item.isActive)
                .map((item) => item.serviceId),
            }
          : undefined,
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
        age: customer.dateOfBirth ? getAge(customer.dateOfBirth) : 0,
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
        communicationState: normalizeCommunicationState(
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
  } catch {
    return fallbackData(false);
  }
}

async function getNestOperationalData(): Promise<OperationalData | null> {
  const candidates = getNestApiCandidates();

  for (const base of candidates) {
    try {
      const response = await fetch(`${base}/operational-data`, {
        cache: "no-store",
      });

      if (response.ok) {
        return (await response.json()) as OperationalData;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function fallbackData(databaseConnected: boolean): OperationalData {
  return {
    organization: seedOrganization,
    providers: seedProviders,
    staff: seedStaff,
    locations: [
      {
        id: "location-main-kathmandu",
        organizationId: seedOrganization.id,
        name: "Kathmandu Main Branch",
        address: "Baluwatar, Kathmandu",
        phone: "+977 01-4420000",
        timezone: "Asia/Kathmandu",
        isActive: true,
      },
    ],
    customers: seedCustomers,
    services: seedServices,
    appointments: seedAppointments,
    followUps: seedFollowUps,
    visitReports: seedVisitReports,
    databaseConnected,
  };
}

function normalizeCommunicationState(value: string): Appointment["communicationState"] {
  if (
    value === "Confirmed by phone" ||
    value === "SMS sent" ||
    value === "Needs call"
  ) {
    return value;
  }

  return "Unconfirmed";
}

function getNestApiCandidates() {
  const bases = new Set<string>();
  bases.add(configuredNestApiBase.replace(/\/$/, ""));

  for (const port of [4000, 4001, 4002, 4003, 4004, 4010]) {
    bases.add(`http://localhost:${port}/api`);
  }

  return [...bases];
}

function getAge(date: Date) {
  const today = new Date("2026-05-06T00:00:00+05:45");
  let age = today.getFullYear() - date.getFullYear();
  const monthDelta = today.getMonth() - date.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }
  return age;
}
