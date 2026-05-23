import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AppointmentStatus, Priority, Prisma } from "@prisma/client";

import { getNepalDayOfWeekFromIso } from "../../lib/nepal-time";
import { AuthService } from "../auth/auth.service";
import { assertClinicOperator } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { ListDaySummariesDto } from "./dto/list-day-summaries.dto";
import { ListAppointmentsDto } from "./dto/list-appointments.dto";
import { ListWeekSummariesDto } from "./dto/list-week-summaries.dto";
import { UpdateAppointmentDto } from "./dto/update-appointment.dto";
import { UpdateAppointmentStatusDto } from "./dto/update-appointment-status.dto";

const blockingStatuses: AppointmentStatus[] = [
  "Scheduled",
  "Confirmed",
  "CheckedIn",
  "InProgress",
  "FollowUpRequired",
];

const recoveryStates = new Set<AppointmentStatus>([
  "NoShow",
  "FollowUpRequired",
  "Rescheduled",
]);

const editableStatuses = new Set<AppointmentStatus>([
  "Scheduled",
  "Confirmed",
  "Rescheduled",
  "FollowUpRequired",
]);

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
    @Inject(SchedulingService)
    private readonly scheduling: SchedulingService,
  ) {}

  async list(query: ListAppointmentsDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        organizationId: session.organizationId,
        providerId: query.providerId,
        customerId: query.customerId,
        locationId: query.locationId,
        status: query.status as AppointmentStatus | undefined,
        startsAt: {
          gte: query.fromIso ? new Date(query.fromIso) : undefined,
          lte: query.toIso ? new Date(query.toIso) : undefined,
        },
      },
      include: {
        services: true,
        resource: true,
      },
      orderBy: [{ startsAt: "asc" }],
    });

    return appointments.map((appointment) => this.mapAppointment(appointment));
  }

  async getOne(id: string, authorization?: string) {
    const session = await this.requireOperator(authorization);
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, organizationId: session.organizationId },
      include: {
        services: true,
        resource: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    return this.mapAppointment(appointment);
  }

  async listDaySummaries(query: ListDaySummariesDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    return this.scheduling.listDaySummaries({
      organizationId: session.organizationId,
      fromDateKey: query.fromDateKey,
      toDateKey: query.toDateKey,
      providerId: query.providerId,
      locationId: query.locationId,
    });
  }

  async listWeekSummaries(query: ListWeekSummariesDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    return this.scheduling.listWeekSummaries({
      organizationId: session.organizationId,
      fromDateKey: query.fromDateKey,
      toDateKey: query.toDateKey,
      providerId: query.providerId,
      locationId: query.locationId,
    });
  }

  async create(dto: CreateAppointmentDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);
    const normalized = await this.validateAndNormalizeAppointment(dto);

    const appointment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          id: dto.id,
          organizationId: dto.organizationId,
          locationId: dto.locationId,
          customerId: dto.customerId,
          providerId: dto.providerId,
          resourceId: normalized.resourceId,
          startsAt: normalized.startsAt,
          endsAt: normalized.endsAt,
          durationMinutes: normalized.durationMinutes,
          bufferMinutes: normalized.bufferMinutes,
          priority: dto.priority,
          status: "Scheduled",
          communicationState: "Unconfirmed",
          notes: dto.notes,
          services: {
            create: dto.serviceIds.map((serviceId) => ({ serviceId })),
          },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "appointment",
          entityId: created.id,
          action: "created",
          newValue: {
            ...dto,
            resourceId: normalized.resourceId ?? null,
            durationMinutes: normalized.durationMinutes,
            bufferMinutes: normalized.bufferMinutes,
          } as Prisma.InputJsonObject,
          description: "Appointment created from Nest API",
        },
      });

      return created;
    });

    return { id: appointment.id };
  }

  async update(id: string, dto: UpdateAppointmentDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);

    const existing = await this.prisma.appointment.findFirst({
      where: { id, organizationId: dto.organizationId },
      include: {
        services: true,
      },
    });

    if (!existing) {
      throw new NotFoundException("Appointment not found");
    }

    if (!editableStatuses.has(existing.status)) {
      throw new BadRequestException(
        "Only scheduled or active planning appointments can be edited",
      );
    }

    const invoiceCount = await this.prisma.invoice.count({
      where: { appointmentId: id },
    });
    if (invoiceCount > 0) {
      throw new BadRequestException(
        "Appointments with billing records cannot be rescheduled directly",
      );
    }

    const normalized = await this.validateAndNormalizeAppointment(dto, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.appointmentService.deleteMany({ where: { appointmentId: id } });

      const appointment = await tx.appointment.update({
        where: { id },
        data: {
          locationId: dto.locationId,
          customerId: dto.customerId,
          providerId: dto.providerId,
          resourceId: normalized.resourceId,
          startsAt: normalized.startsAt,
          endsAt: normalized.endsAt,
          durationMinutes: normalized.durationMinutes,
          bufferMinutes: normalized.bufferMinutes,
          priority: dto.priority,
          notes: dto.notes,
          services: {
            create: dto.serviceIds.map((serviceId) => ({ serviceId })),
          },
        },
      });

      await tx.workflowEvent.create({
        data: {
          organizationId: dto.organizationId,
          appointmentId: id,
          fromStatus: existing.status,
          toStatus: "Rescheduled",
          actorUserId: session.id,
          note: "Appointment details updated",
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "appointment",
          entityId: id,
          action: "updated",
          oldValue: {
            providerId: existing.providerId,
            customerId: existing.customerId,
            startsAtIso: existing.startsAt.toISOString(),
            durationMinutes: existing.durationMinutes,
          },
          newValue: {
            ...dto,
            resourceId: normalized.resourceId ?? null,
            durationMinutes: normalized.durationMinutes,
            bufferMinutes: normalized.bufferMinutes,
          } as Prisma.InputJsonObject,
          description: "Appointment updated",
        },
      });

      return appointment;
    });

    return { id: updated.id };
  }

  async delete(id: string, authorization?: string) {
    const session = await this.requireOperator(authorization);
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, organizationId: session.organizationId },
      select: {
        organizationId: true,
        id: true,
        status: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    if (["CheckedIn", "InProgress", "Completed"].includes(appointment.status)) {
      throw new BadRequestException(
        "In-progress or completed appointments must remain in history",
      );
    }

    const [invoiceCount, paymentCount] = await Promise.all([
      this.prisma.invoice.count({ where: { appointmentId: id } }),
      this.prisma.payment.count({ where: { appointmentId: id } }),
    ]);

    if (invoiceCount || paymentCount) {
      throw new BadRequestException(
        "Appointments with billing history cannot be deleted",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId: appointment.organizationId,
          actorId: session.id,
          entityType: "appointment",
          entityId: appointment.id,
          action: "deleted",
          description: "Appointment deleted from schedule",
        },
      });

      await tx.appointment.delete({ where: { id } });
    });

    return { ok: true };
  }

  async updateStatus(id: string, dto: UpdateAppointmentStatusDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    const existing = await this.prisma.appointment.findFirst({
      where: { id, organizationId: session.organizationId },
      select: {
        id: true,
        organizationId: true,
        customerId: true,
        providerId: true,
        priority: true,
        status: true,
      },
    });

    if (!existing) {
      throw new NotFoundException("Appointment not found");
    }

    const [, , appointment] = await this.prisma.$transaction([
      this.prisma.workflowEvent.create({
        data: {
          organizationId: existing.organizationId,
          appointmentId: existing.id,
          fromStatus: existing.status,
          toStatus: dto.status,
          actorUserId: session.id,
          note: dto.note,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: existing.organizationId,
          actorId: session.id,
          entityType: "appointment",
          entityId: existing.id,
          action:
            dto.status === "NoShow"
              ? "no_show"
              : dto.status === "Completed"
                ? "completed"
                : "status_changed",
          oldValue: { status: existing.status },
          newValue: { status: dto.status },
          description: dto.note,
        },
      }),
      this.prisma.appointment.update({
        where: { id },
        data: {
          status: dto.status,
          communicationState:
            dto.status === "Confirmed"
              ? "Confirmed by phone"
              : recoveryStates.has(dto.status)
                ? "Needs call"
                : undefined,
        },
        select: {
          id: true,
          organizationId: true,
          customerId: true,
          providerId: true,
          priority: true,
        },
      }),
    ]);

    if (recoveryStates.has(dto.status)) {
      const existingFollowUp = await this.prisma.followUpTask.findFirst({
        where: {
          appointmentId: appointment.id,
          status: { in: ["Open", "InProgress", "Waiting", "Blocked"] },
        },
        select: { id: true },
      });

      if (!existingFollowUp) {
        await this.prisma.followUpTask.create({
          data: {
            organizationId: appointment.organizationId,
            appointmentId: appointment.id,
            customerId: appointment.customerId,
            ownerId: appointment.providerId,
            type:
              dto.status === "NoShow"
                ? "NoShowRecovery"
                : "TreatmentContinuation",
            priority: appointment.priority === "Urgent" ? "Urgent" : "High",
            dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            summary: `${dto.status.replace(/([A-Z])/g, " $1").trim()} recovery`,
            nextAction:
              dto.note || "Contact customer and define the next operational step.",
          },
        });
      }
    }

    return { ok: true };
  }

  private async requireOperator(authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session.role);
    return session;
  }

  private assertSameOrganization(sessionOrganizationId: string, targetOrganizationId: string) {
    if (sessionOrganizationId !== targetOrganizationId) {
      throw new BadRequestException("Cross-organization appointment access is not allowed");
    }
  }

  private async validateAndNormalizeAppointment(
    dto: CreateAppointmentDto | UpdateAppointmentDto,
    excludeAppointmentId?: string,
  ) {
    const startsAt = new Date(dto.startsAtIso);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException("Invalid appointment start time");
    }

    const resourceId = await this.resolveResourceId(dto);

    const [customer, provider, timing] =
      await Promise.all([
        this.prisma.customer.findFirst({
          where: { id: dto.customerId, organizationId: dto.organizationId },
          select: { id: true },
        }),
        this.prisma.provider.findFirst({
          where: { id: dto.providerId, organizationId: dto.organizationId },
          select: {
            id: true,
            organizationId: true,
            status: true,
            user: {
              select: {
                status: true,
              },
            },
          },
        }),
        this.scheduling.getServiceTiming({
          organizationId: dto.organizationId,
          providerId: dto.providerId,
          locationId: dto.locationId,
          serviceIds: dto.serviceIds,
        }),
      ]);

    if (!customer || !provider) {
      throw new BadRequestException(
        "Invalid organization, customer, or provider",
      );
    }

    if (provider.status === "Inactive" || provider.user?.status === "Inactive") {
      throw new ConflictException("Selected provider is inactive");
    }

    const durationMinutes = timing.durationMinutes;
    const bufferMinutes = Math.max(dto.bufferMinutes, timing.serviceBufferMinutes);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    await this.scheduling.assertSlotAvailable({
      organizationId: dto.organizationId,
      providerId: dto.providerId,
      locationId: dto.locationId,
      resourceId,
      startsAtIso: dto.startsAtIso,
      durationMinutes,
      bufferMinutes,
      excludeAppointmentId,
    });

    return {
      startsAt,
      endsAt,
      durationMinutes,
      bufferMinutes,
      resourceId,
    };
  }

  private async resolveResourceId(dto: CreateAppointmentDto | UpdateAppointmentDto) {
    if (dto.resourceId) {
      const resource = await this.prisma.resource.findFirst({
        where: {
          id: dto.resourceId,
          organizationId: dto.organizationId,
          locationId: dto.locationId ?? undefined,
        },
        select: { id: true },
      });

      if (!resource) {
        throw new BadRequestException("Selected chair or resource is invalid");
      }

      return resource.id;
    }

    if (!dto.chair) {
      return undefined;
    }

    const resource = await this.prisma.resource.findFirst({
      where: {
        organizationId: dto.organizationId,
        name: dto.chair,
        locationId: dto.locationId ?? undefined,
      },
      select: { id: true },
    });

    return resource?.id;
  }

  private mapAppointment(appointment: {
    id: string;
    organizationId: string;
    locationId: string | null;
    customerId: string;
    providerId: string;
    resourceId: string | null;
    startsAt: Date;
    endsAt: Date;
    durationMinutes: number;
    bufferMinutes: number;
    status: AppointmentStatus;
    priority: Priority;
    communicationState: string;
    notes: string | null;
    resource: { name: string } | null;
    services: Array<{ serviceId: string }>;
  }) {
    return {
      id: appointment.id,
      organizationId: appointment.organizationId,
      locationId: appointment.locationId ?? undefined,
      customerId: appointment.customerId,
      providerId: appointment.providerId,
      resourceId: appointment.resourceId ?? undefined,
      serviceIds: appointment.services.map((item) => item.serviceId),
      startsAtIso: appointment.startsAt.toISOString(),
      endsAtIso: appointment.endsAt.toISOString(),
      durationMinutes: appointment.durationMinutes,
      bufferMinutes: appointment.bufferMinutes,
      status: appointment.status,
      priority: appointment.priority,
      chair: appointment.resource?.name ?? undefined,
      notes: appointment.notes ?? "",
      communicationState: appointment.communicationState,
    };
  }
}
