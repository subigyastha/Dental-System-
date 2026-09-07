import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AppointmentStatus, Priority, Prisma } from "@prisma/client";

import { getNepalAdDateKeyFromIso, getNepalDayOfWeekFromIso } from "../../lib/nepal-time";
import { AuthService } from "../auth/auth.service";
import {
  assertBookingActor,
  assertClinicOperator,
  assertClinicOperatorForLocation,
} from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";
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
];

const recoveryStates = new Set<AppointmentStatus>([
  "NoShow",
  "FollowUpRequired",
  "Rescheduled",
]);

const editableStatuses = new Set<AppointmentStatus>([
  "Scheduled",
  "Confirmed",
]);

const allowedStatusTransitions: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  Scheduled: ["Confirmed", "CheckedIn", "Cancelled", "NoShow"],
  Confirmed: ["CheckedIn", "Cancelled", "NoShow"],
  CheckedIn: ["InProgress"],
  InProgress: ["Completed"],
  Completed: [],
  Cancelled: [],
  NoShow: [],
  // Rescheduling is intentionally not exposed by the generic status endpoint:
  // it must create and link a validated successor in one transaction.
  Rescheduled: [],
  // A follow-up is a linked task, not an appointment lifecycle state.
  FollowUpRequired: [],
};

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

  async list(
    query: ListAppointmentsDto & { providerIds?: string[] },
    authorization?: string,
  ) {
    const session = await this.requireOperator(authorization, query.locationId);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        organizationId: session.organizationId,
        providerId: query.providerIds?.length
          ? { in: query.providerIds }
          : query.providerId,
        customerId: query.customerId,
        locationId: query.locationId,
        status: query.status as AppointmentStatus | undefined,
        startsAt: {
          gte: query.fromIso ? new Date(query.fromIso) : undefined,
          lte: query.toIso ? new Date(query.toIso) : undefined,
        },
      },
      include: {
        customer: {
          select: { id: true, fullName: true, patientCode: true },
        },
        provider: {
          select: { id: true, displayName: true, color: true, specialty: true },
        },
        services: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
                category: true,
                durationMinutes: true,
                bufferMinutes: true,
              },
            },
          },
        },
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
        customer: {
          select: { id: true, fullName: true, patientCode: true },
        },
        provider: {
          select: { id: true, displayName: true, color: true, specialty: true },
        },
        services: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
                category: true,
                durationMinutes: true,
                bufferMinutes: true,
              },
            },
          },
        },
        resource: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    return this.mapAppointment(appointment);
  }

  async listDaySummaries(query: ListDaySummariesDto, authorization?: string) {
    const session = await this.requireOperator(authorization, query.locationId);
    return this.scheduling.listDaySummaries({
      organizationId: session.organizationId,
      fromDateKey: query.fromDateKey,
      toDateKey: query.toDateKey,
      providerId: query.providerId,
      locationId: query.locationId,
    });
  }

  async listWeekSummaries(query: ListWeekSummariesDto, authorization?: string) {
    const session = await this.requireOperator(authorization, query.locationId);
    return this.scheduling.listWeekSummaries({
      organizationId: session.organizationId,
      fromDateKey: query.fromDateKey,
      toDateKey: query.toDateKey,
      providerId: query.providerId,
      locationId: query.locationId,
    });
  }

  async create(dto: CreateAppointmentDto, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertBookingActor(session, dto.locationId, dto.providerId);
    this.assertSameOrganization(session.organizationId, dto.organizationId);
    const normalized = await this.validateAndNormalizeAppointment(dto);

    const appointment = await this.withProviderBookingConflictGuard(() => this.prisma.$transaction(async (tx) => {
      await this.lockProviderForBooking(
        tx,
        dto.organizationId,
        dto.providerId,
      );
      const holdId = await this.assertBookingHold(
        tx,
        dto,
        normalized,
        session.id,
      );
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

      if (holdId) {
        await this.consumeBookingHold(tx, holdId);
      }

      return created;
    }));

    this.scheduling.invalidateAppointmentPlanning({
      organizationId: dto.organizationId,
      providerIds: [dto.providerId],
      dateKeys: [getNepalAdDateKeyFromIso(dto.startsAtIso)],
      locationId: dto.locationId,
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

    const requestedStart = new Date(dto.startsAtIso);
    const serviceIdsChanged =
      existing.services.length !== dto.serviceIds.length ||
      existing.services.some((service) => !dto.serviceIds.includes(service.serviceId));
    if (
      requestedStart.getTime() !== existing.startsAt.getTime() ||
      dto.providerId !== existing.providerId ||
      dto.locationId !== (existing.locationId ?? undefined) ||
      serviceIdsChanged
    ) {
      throw new BadRequestException(
        "Changing provider, time, location, or services requires the governed reschedule command",
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

    const updated = await this.withProviderBookingConflictGuard(() => this.prisma.$transaction(async (tx) => {
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
          toStatus: existing.status,
          actorUserId: session.id,
          note: "Appointment planning details updated",
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
    }));

    this.scheduling.invalidateAppointmentPlanning({
      organizationId: dto.organizationId,
      providerIds: [...new Set([existing.providerId, dto.providerId])],
      dateKeys: [
        getNepalAdDateKeyFromIso(existing.startsAt.toISOString()),
        getNepalAdDateKeyFromIso(dto.startsAtIso),
      ],
      locationId: dto.locationId ?? existing.locationId ?? undefined,
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
        providerId: true,
        locationId: true,
        startsAt: true,
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

    this.scheduling.invalidateAppointmentPlanning({
      organizationId: appointment.organizationId,
      providerIds: [appointment.providerId],
      dateKeys: [getNepalAdDateKeyFromIso(appointment.startsAt.toISOString())],
      locationId: appointment.locationId ?? undefined,
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
        locationId: true,
        priority: true,
        status: true,
        startsAt: true,
        endsAt: true,
        bufferMinutes: true,
      },
    });

    if (!existing) {
      throw new NotFoundException("Appointment not found");
    }

    this.assertLifecycleAuthority(session, existing, dto.status);

    if (dto.status === "Rescheduled") {
      throw new BadRequestException(
        "Use the governed reschedule command so the original appointment and validated successor remain linked",
      );
    }
    if (dto.status === "FollowUpRequired") {
      throw new BadRequestException(
        "Follow-up requirement is recorded as a linked task, not an appointment status",
      );
    }
    if (!allowedStatusTransitions[existing.status].includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition an appointment from ${existing.status} to ${dto.status}`,
      );
    }
    if (["Cancelled", "NoShow"].includes(dto.status) && !dto.note?.trim()) {
      throw new BadRequestException(`${dto.status === "Cancelled" ? "Cancellation" : "No-show"} reason is required`);
    }
    if (dto.status === "NoShow") {
      const scheduledEndWithBuffer = existing.endsAt.getTime() + existing.bufferMinutes * 60_000;
      const roles = session.effectiveRoles ?? [session.role];
      const ownerOrAdmin = roles.includes("Owner") || roles.includes("Admin");
      if (Date.now() < scheduledEndWithBuffer && !ownerOrAdmin) {
        throw new BadRequestException("A no-show can only be recorded after the scheduled end and buffer");
      }
      if (Date.now() < scheduledEndWithBuffer && ownerOrAdmin && !dto.note?.trim()) {
        throw new BadRequestException("An early no-show requires an Owner or Admin reason");
      }
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

    this.scheduling.invalidateAppointmentPlanning({
      organizationId: existing.organizationId,
      providerIds: [existing.providerId],
      dateKeys: [getNepalAdDateKeyFromIso(existing.startsAt.toISOString())],
      locationId: existing.locationId ?? undefined,
    });

    return { ok: true };
  }

  async confirm(id: string, reason?: string, authorization?: string) {
    return this.updateStatus(id, { status: "Confirmed", note: reason }, authorization);
  }

  async checkIn(id: string, reason?: string, authorization?: string) {
    return this.updateStatus(id, { status: "CheckedIn", note: reason }, authorization);
  }

  async start(id: string, reason?: string, authorization?: string) {
    return this.updateStatus(id, { status: "InProgress", note: reason }, authorization);
  }

  async complete(id: string, reason?: string, authorization?: string) {
    return this.updateStatus(id, { status: "Completed", note: reason }, authorization);
  }

  async cancel(id: string, reason?: string, authorization?: string) {
    return this.updateStatus(id, { status: "Cancelled", note: reason }, authorization);
  }

  async noShow(id: string, reason?: string, authorization?: string) {
    return this.updateStatus(id, { status: "NoShow", note: reason }, authorization);
  }

  async reschedule(id: string, dto: RescheduleAppointmentDto, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertBookingActor(session, dto.locationId, dto.providerId);
    this.assertSameOrganization(session.organizationId, dto.organizationId);
    if (!dto.reason.trim()) throw new BadRequestException("Reschedule reason is required");

    const existing = await this.prisma.appointment.findFirst({
      where: { id, organizationId: session.organizationId },
      include: { services: { select: { serviceId: true } } },
    });
    if (!existing) throw new NotFoundException("Appointment not found");
    this.assertLifecycleAuthority(session, existing, "Rescheduled");
    if (!["Scheduled", "Confirmed"].includes(existing.status)) {
      throw new BadRequestException("Only scheduled or confirmed appointments can be rescheduled");
    }
    const [invoiceCount, paymentCount] = await Promise.all([
      this.prisma.invoice.count({ where: { appointmentId: id } }),
      this.prisma.payment.count({ where: { appointmentId: id } }),
    ]);
    if (invoiceCount || paymentCount) {
      throw new BadRequestException(
        "Appointments with billing history need an authorized billing decision before rescheduling",
      );
    }

    const normalized = await this.validateAndNormalizeAppointment(dto);
    const successor = await this.withProviderBookingConflictGuard(() => this.prisma.$transaction(async (tx) => {
      await this.lockProviderForBooking(
        tx,
        dto.organizationId,
        dto.providerId,
      );
      const holdId = await this.assertBookingHold(
        tx,
        dto,
        normalized,
        session.id,
      );
      await tx.appointment.update({
        where: { id },
        data: { status: "Rescheduled", cancellationReason: dto.reason.trim() },
      });
      const created = await tx.appointment.create({
        data: {
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
          sourceAppointmentId: id,
          services: { create: dto.serviceIds.map((serviceId) => ({ serviceId })) },
        },
      });
      await tx.workflowEvent.createMany({
        data: [
          {
            organizationId: dto.organizationId,
            appointmentId: id,
            fromStatus: existing.status,
            toStatus: "Rescheduled",
            actorUserId: session.id,
            note: dto.reason.trim(),
          },
          {
            organizationId: dto.organizationId,
            appointmentId: created.id,
            fromStatus: null,
            toStatus: "Scheduled",
            actorUserId: session.id,
            note: `Successor of ${id}`,
          },
        ],
      });
      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "appointment",
          entityId: id,
          action: "rescheduled",
          oldValue: { status: existing.status, startsAtIso: existing.startsAt.toISOString() },
          newValue: { successorAppointmentId: created.id, reason: dto.reason.trim(), startsAtIso: normalized.startsAt.toISOString() },
          description: "Appointment rescheduled with a linked successor",
        },
      });
      if (holdId) {
        await this.consumeBookingHold(tx, holdId);
      }
      return created;
    }));

    this.scheduling.invalidateAppointmentPlanning({
      organizationId: dto.organizationId,
      providerIds: [...new Set([existing.providerId, dto.providerId])],
      dateKeys: [
        getNepalAdDateKeyFromIso(existing.startsAt.toISOString()),
        getNepalAdDateKeyFromIso(dto.startsAtIso),
      ],
      locationId: dto.locationId ?? existing.locationId ?? undefined,
    });
    return { originalAppointmentId: id, successorAppointmentId: successor.id };
  }

  private assertLifecycleAuthority(
    session: { role: string; effectiveRoles?: string[]; providerId?: string; effectiveRoleScopes?: Array<{ role: string; locationId: string | null }> },
    appointment: { providerId: string; locationId: string | null },
    target: AppointmentStatus,
  ) {
    if (appointment.locationId) {
      assertClinicOperatorForLocation(session, appointment.locationId);
    }

    const roles = session.effectiveRoles ?? [session.role];
    const isOwnerOrAdmin = roles.includes("Owner") || roles.includes("Admin");
    const isSchedulingStaff = roles.some((role) =>
      ["Owner", "Admin", "Manager", "Receptionist", "Scheduler"].includes(role),
    );
    const isOwnProvider = roles.includes("Provider") && session.providerId === appointment.providerId;

    if (["InProgress", "Completed"].includes(target)) {
      if (isOwnerOrAdmin || isOwnProvider) return;
      throw new ForbiddenException("Only the assigned Provider or an Owner/Admin can begin or complete this appointment");
    }
    if (isSchedulingStaff || isOwnProvider) return;
    throw new ForbiddenException("You are not allowed to perform this appointment workflow action");
  }

  private async requireOperator(authorization?: string, locationId?: string) {
    const session = await this.auth.requireSession(authorization);
    if (locationId) assertClinicOperatorForLocation(session, locationId);
    else assertClinicOperator(session);
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
          select: {
            id: true,
            archivedAt: true,
            mergedIntoCustomerId: true,
          },
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

    if (customer.archivedAt || customer.mergedIntoCustomerId) {
      throw new ConflictException(
        "Selected client is unavailable for appointment booking",
      );
    }

    if (provider.status === "Inactive" || provider.user?.status === "Inactive") {
      throw new ConflictException("Selected provider is inactive");
    }

    // The service/provider duration is the safe minimum. Direct-time booking
    // may extend the appointment, but can never under-allocate the configured
    // clinical duration.
    const durationMinutes = Math.max(dto.durationMinutes, timing.durationMinutes);
    const bufferMinutes = Math.max(dto.bufferMinutes, timing.serviceBufferMinutes);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    await this.scheduling.assertSlotAvailable({
      organizationId: dto.organizationId,
      providerId: dto.providerId,
      locationId: dto.locationId,
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

  private async withProviderBookingConflictGuard<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (this.isProviderOverlapConstraintError(error)) {
        throw new ConflictException("Slot no longer available for the selected provider");
      }
      throw error;
    }
  }

  private async lockProviderForBooking(
    tx: Prisma.TransactionClient,
    organizationId: string,
    providerId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Provider"
      WHERE "id" = ${providerId}
        AND "organizationId" = ${organizationId}
      FOR UPDATE
    `);
    if (rows.length !== 1) {
      throw new BadRequestException("Invalid organization or provider");
    }
  }

  private async assertBookingHold(
    tx: Prisma.TransactionClient,
    dto: CreateAppointmentDto | RescheduleAppointmentDto,
    normalized: {
      startsAt: Date;
      endsAt: Date;
      durationMinutes: number;
      bufferMinutes: number;
    },
    actorId: string,
  ) {
    const nowRows = await tx.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`,
    );
    const transactionNow = nowRows[0]?.now ?? new Date();
    const activeHolds = await tx.bookingSlotHold.findMany({
      where: {
        organizationId: dto.organizationId,
        providerId: dto.providerId,
        releasedAt: null,
        consumedAt: null,
        expiresAt: { gt: transactionNow },
      },
    });
    const requestedEnd = new Date(
      normalized.endsAt.getTime() + normalized.bufferMinutes * 60_000,
    );
    const overlapsRequestedTime = activeHolds.filter((hold) =>
      normalized.startsAt <
        new Date(
          hold.endsAt.getTime() + hold.bufferMinutes * 60_000,
        ) && hold.startsAt < requestedEnd,
    );

    if (!dto.holdId) {
      if (overlapsRequestedTime.length) {
        throw new ConflictException(
          "This time is temporarily held by another booking",
        );
      }
      return null;
    }

    const ownHold = activeHolds.find((hold) => hold.id === dto.holdId);
    if (
      !ownHold ||
      ownHold.createdByUserId !== actorId ||
      ownHold.locationId !== dto.locationId ||
      ownHold.serviceId !== dto.serviceIds[0] ||
      dto.serviceIds.length !== 1 ||
      ownHold.startsAt.getTime() !== normalized.startsAt.getTime() ||
      ownHold.endsAt.getTime() !== normalized.endsAt.getTime() ||
      ownHold.bufferMinutes !== normalized.bufferMinutes
    ) {
      throw new ConflictException(
        "The selected slot hold expired or no longer matches this booking",
      );
    }
    if (overlapsRequestedTime.some((hold) => hold.id !== ownHold.id)) {
      throw new ConflictException(
        "The selected time is no longer available",
      );
    }
    return ownHold.id;
  }

  private async consumeBookingHold(
    tx: Prisma.TransactionClient,
    holdId: string,
  ) {
    const nowRows = await tx.$queryRaw<Array<{ now: Date }>>(
      Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`,
    );
    const transactionNow = nowRows[0]?.now ?? new Date();
    const consumed = await tx.bookingSlotHold.updateMany({
      where: {
        id: holdId,
        releasedAt: null,
        consumedAt: null,
        expiresAt: { gt: transactionNow },
      },
      data: { consumedAt: transactionNow },
    });
    if (consumed.count !== 1) {
      throw new ConflictException(
        "The selected slot hold expired or was released",
      );
    }
  }

  private isProviderOverlapConstraintError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    const meta =
      error && typeof error === "object" && "meta" in error
        ? JSON.stringify((error as { meta?: unknown }).meta)
        : "";

    return (
      message.includes("Appointment_provider_time_no_overlap") ||
      message.includes("23P01") ||
      message.toLowerCase().includes("exclusion constraint") ||
      meta.includes("Appointment_provider_time_no_overlap") ||
      (code === "P2004" && meta.toLowerCase().includes("constraint"))
    );
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
    customer?: {
      id: string;
      fullName: string;
      patientCode: string | null;
    };
    provider?: {
      id: string;
      displayName: string;
      color: string;
      specialty: string | null;
    };
    services: Array<{
      serviceId: string;
      service?: {
        id: string;
        name: string;
        category: string;
        durationMinutes: number;
        bufferMinutes: number;
      };
    }>;
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
      clientSummary: appointment.customer
        ? {
            id: appointment.customer.id,
            name: appointment.customer.fullName,
            patientCode: appointment.customer.patientCode ?? undefined,
          }
        : undefined,
      providerSummary: appointment.provider
        ? {
            id: appointment.provider.id,
            name: appointment.provider.displayName,
            color: appointment.provider.color,
            specialty: appointment.provider.specialty ?? undefined,
          }
        : undefined,
      serviceSummaries: appointment.services.flatMap((item) =>
        item.service ? [item.service] : [],
      ),
    };
  }
}
