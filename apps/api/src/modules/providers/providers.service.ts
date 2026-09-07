import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { mapProviderToClient } from "../../lib/map-provider";
import { AuthService } from "../auth/auth.service";
import { assertClinicAdmin, assertClinicOperator, assertClinicOperatorForLocation, isClinicAdmin } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { CreateProviderDto } from "./dto/create-provider.dto";
import { ListProviderScheduleGridDto } from "./dto/list-provider-schedule-grid.dto";
import { ListProviderScheduleGridsDto } from "./dto/list-provider-schedule-grids.dto";
import { ListProviderSlotsDto } from "./dto/list-provider-slots.dto";
import { UpdateProviderDto } from "./dto/update-provider.dto";
import {
  AvailabilityWindowDto,
  BlockedTimeDto,
  RecurringBlockDto,
  UpdateProviderScheduleDto,
} from "./dto/update-provider-schedule.dto";

const providerInclude = {
  availability: {
    orderBy: [{ dayOfWeek: "asc" as const }, { startsAtLocal: "asc" as const }],
  },
  blockedTimes: {
    orderBy: { startsAt: "asc" as const },
  },
  recurringBlocks: {
    orderBy: [{ dayOfWeek: "asc" as const }, { startsAtLocal: "asc" as const }],
  },
  providerServices: true,
} satisfies Prisma.ProviderInclude;

const STANDARD_SLOT_MINUTES = 60;

@Injectable()
export class ProvidersService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
    @Inject(SchedulingService)
    private readonly scheduling: SchedulingService,
  ) {}

  async list(authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session);
    const providers = await this.prisma.provider.findMany({
      where: { organizationId: session.organizationId },
      include: providerInclude,
      orderBy: [{ displayName: "asc" }],
    });

    return providers.map((provider) => mapProviderToClient(provider));
  }

  async getOne(id: string, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session);
    const provider = await this.prisma.provider.findFirst({
      where: { id, organizationId: session.organizationId },
      include: providerInclude,
    });

    if (!provider) {
      throw new NotFoundException("Provider not found");
    }

    return mapProviderToClient(provider);
  }

  async create(dto: CreateProviderDto, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicAdmin(session);
    const provider = await this.prisma.provider.create({
      data: {
        organizationId: dto.organizationId,
        displayName: dto.name,
        roleLabel: dto.roleLabel,
        specialty: dto.specialty ?? "",
        color: dto.color ?? "#0f766e",
        status: dto.status ?? "Available",
      },
      include: providerInclude,
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId: dto.organizationId,
        actorId: session.id,
        entityType: "provider",
        entityId: provider.id,
        action: "created",
        newValue: { ...dto },
        description: "Provider created",
      },
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId: dto.organizationId,
      providerId: provider.id,
    });

    return mapProviderToClient(provider);
  }

  async remove(id: string, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicAdmin(session);
    const existing = await this.prisma.provider.findUnique({
      where: { id },
      select: { id: true, organizationId: true },
    });

    if (!existing) {
      throw new NotFoundException("Provider not found");
    }

    const appointmentCount = await this.prisma.appointment.count({
      where: { providerId: id },
    });

    if (appointmentCount > 0) {
      const updated = await this.prisma.provider.update({
        where: { id },
        data: { status: "Inactive" },
        include: providerInclude,
      });

      await this.prisma.auditLog.create({
        data: {
          organizationId: existing.organizationId,
          actorId: session.id,
          entityType: "provider",
          entityId: id,
          action: "deactivated",
          description:
            "Provider has appointments; marked inactive instead of deleting",
        },
      });

      this.scheduling.invalidateProviderSchedulePlanning({
        organizationId: existing.organizationId,
        providerId: id,
      });

      return mapProviderToClient(updated);
    }

    await this.prisma.provider.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        organizationId: existing.organizationId,
        actorId: session.id,
        entityType: "provider",
        entityId: id,
        action: "deleted",
        description: "Provider removed",
      },
    });

    return { id, removed: true as const };
  }

  async update(id: string, dto: UpdateProviderDto, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicAdmin(session);
    const provider = await this.prisma.provider.update({
      where: { id },
      data: {
        displayName: dto.name,
        roleLabel: dto.roleLabel,
        specialty: dto.specialty,
        color: dto.color,
        status: dto.status,
      },
      select: { id: true, organizationId: true },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId: provider.organizationId,
        actorId: session.id,
        entityType: "provider",
        entityId: provider.id,
        action: "updated",
        newValue: { ...dto },
        description: "Provider profile updated",
      },
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId: provider.organizationId,
      providerId: provider.id,
    });

    return { id: provider.id };
  }

  async getSchedule(id: string, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session);
    const provider = await this.prisma.provider.findFirst({
      where: { id, organizationId: session.organizationId },
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
      },
    });

    if (!provider) {
      throw new NotFoundException("Provider not found");
    }

    return {
      providerId: provider.id,
      organizationId: provider.organizationId,
      availability: provider.availability.map((item) => ({
        id: item.id,
        providerId: item.providerId,
        locationId: item.locationId ?? undefined,
        dayOfWeek: item.dayOfWeek,
        startsAtLocal: item.startsAtLocal,
        endsAtLocal: item.endsAtLocal,
        slotDurationMinutes: STANDARD_SLOT_MINUTES,
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
    };
  }

  async listSlots(id: string, query: ListProviderSlotsDto, authorization?: string) {
    await this.requireScheduleViewAccess(id, query.organizationId, authorization, query.locationId);
    return this.scheduling.listProviderSlots({
      organizationId: query.organizationId,
      providerId: id,
      dateKey: query.date,
      locationId: query.locationId,
      serviceId: query.serviceId,
      durationMinutes: query.durationMinutes,
      excludeAppointmentId: query.excludeAppointmentId,
    });
  }

  async listScheduleGrids(
    query: ListProviderScheduleGridsDto,
    authorization?: string,
  ) {
    const providerIds = query.providerIds
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    await this.requireScheduleGridViewAccess(
      query.organizationId,
      providerIds,
      authorization, query.locationId,
    );

    return this.scheduling.listScheduleGridForDay({
      organizationId: query.organizationId,
      providerIds,
      dateKey: query.dateIso,
      locationId: query.locationId,
    });
  }

  async listScheduleGrid(
    id: string,
    query: ListProviderScheduleGridDto,
    authorization?: string,
  ) {
    await this.requireScheduleViewAccess(id, query.organizationId, authorization, query.locationId);
    return this.scheduling.listScheduleGridForDay({
      organizationId: query.organizationId,
      providerIds: [id],
      dateKey: query.dateIso,
      locationId: query.locationId,
    });
  }

  async updateSchedule(id: string, dto: UpdateProviderScheduleDto, authorization?: string) {
    const session = await this.requireScheduleAccess(id, dto.organizationId, authorization);
    this.validateAvailabilityWindows(dto.availability);
    this.validateRecurringBlocks(dto.recurringBlocks ?? []);
    this.validateBlockedTimes(dto.blockedTimes);

    await this.prisma.$transaction(async (tx) => {
      await tx.providerAvailability.deleteMany({ where: { providerId: id } });
      await tx.providerRecurringBlock.deleteMany({ where: { providerId: id } });
      await tx.blockedTime.deleteMany({ where: { providerId: id } });
      if (dto.availability.length) {
        await tx.providerAvailability.createMany({
          data: dto.availability.map((item) => ({
            organizationId: dto.organizationId,
            providerId: id,
            locationId: item.locationId,
            dayOfWeek: item.dayOfWeek,
            startsAtLocal: item.startsAtLocal,
            endsAtLocal: item.endsAtLocal,
            slotDurationMinutes: STANDARD_SLOT_MINUTES,
            bufferMinutes: item.bufferMinutes,
            isActive: item.isActive,
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          })),
        });
      }
      if (dto.recurringBlocks?.length) {
        await tx.providerRecurringBlock.createMany({
          data: dto.recurringBlocks.map((item) => ({
            organizationId: dto.organizationId,
            providerId: id,
            locationId: item.locationId,
            dayOfWeek: item.dayOfWeek,
            startsAtLocal: item.startsAtLocal,
            endsAtLocal: item.endsAtLocal,
            reason: item.reason,
            isActive: item.isActive,
          })),
        });
      }
      if (dto.blockedTimes.length) {
        await tx.blockedTime.createMany({
          data: dto.blockedTimes.map((item) => ({
            organizationId: dto.organizationId,
            providerId: id,
            locationId: item.locationId,
            startsAt: new Date(item.startsAtIso),
            endsAt: new Date(item.endsAtIso),
            reason: item.reason,
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "provider_availability",
          entityId: id,
          action: "updated",
          newValue: {
            availability: dto.availability.map((item) => ({ ...item })),
            recurringBlocks: (dto.recurringBlocks ?? []).map((item) => ({ ...item })),
            blockedTimes: dto.blockedTimes.map((item) => ({ ...item })),
          },
          description: "Provider schedule updated",
        },
      });
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId: dto.organizationId,
      providerId: id,
    });

    return { ok: true };
  }

  async createAvailabilityEntry(
    providerId: string,
    organizationId: string,
    dto: AvailabilityWindowDto,
    authorization?: string,
  ) {
    const session = await this.requireScheduleAccess(providerId, organizationId, authorization);
    this.validateAvailabilityWindows([dto]);
    await this.ensureAvailabilityEntryIsConflictFree(providerId, organizationId, dto);

    const created = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.providerAvailability.create({
        data: {
          organizationId,
          providerId,
          locationId: dto.locationId,
          dayOfWeek: dto.dayOfWeek,
          startsAtLocal: dto.startsAtLocal,
          endsAtLocal: dto.endsAtLocal,
          slotDurationMinutes: STANDARD_SLOT_MINUTES,
          bufferMinutes: dto.bufferMinutes,
          isActive: dto.isActive,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: session.id,
          entityType: "provider_availability",
          entityId: entry.id,
          action: "created",
          newValue: { ...dto },
          description: "Provider availability window created",
        },
      });

      return entry;
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId,
      providerId,
      locationId: dto.locationId,
    });

    return created;
  }

  async updateAvailabilityEntry(
    providerId: string,
    entryId: string,
    organizationId: string,
    dto: AvailabilityWindowDto,
    authorization?: string,
  ) {
    const session = await this.requireScheduleAccess(providerId, organizationId, authorization);
    this.validateAvailabilityWindows([dto]);

    const existing = await this.prisma.providerAvailability.findFirst({
      where: { id: entryId, providerId, organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException("Availability entry not found");
    }

    await this.ensureAvailabilityEntryIsConflictFree(
      providerId,
      organizationId,
      dto,
      entryId,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.providerAvailability.update({
        where: { id: entryId },
        data: {
          locationId: dto.locationId,
          dayOfWeek: dto.dayOfWeek,
          startsAtLocal: dto.startsAtLocal,
          endsAtLocal: dto.endsAtLocal,
          slotDurationMinutes: STANDARD_SLOT_MINUTES,
          bufferMinutes: dto.bufferMinutes,
          isActive: dto.isActive,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: session.id,
          entityType: "provider_availability",
          entityId: entry.id,
          action: "updated",
          newValue: { ...dto },
          description: "Provider availability window updated",
        },
      });

      return entry;
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId,
      providerId,
      locationId: dto.locationId,
    });

    return updated;
  }

  async deleteAvailabilityEntry(
    providerId: string,
    entryId: string,
    organizationId: string,
    authorization?: string,
  ) {
    const session = await this.requireScheduleAccess(providerId, organizationId, authorization);
    const existing = await this.prisma.providerAvailability.findFirst({
      where: { id: entryId, providerId, organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException("Availability entry not found");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: session.id,
          entityType: "provider_availability",
          entityId: entryId,
          action: "deleted",
          description: "Provider availability window deleted",
        },
      });

      await tx.providerAvailability.delete({ where: { id: entryId } });
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId,
      providerId,
    });

    return { ok: true };
  }

  async createBlockedTime(
    providerId: string,
    organizationId: string,
    dto: BlockedTimeDto,
    authorization?: string,
  ) {
    const session = await this.requireScheduleAccess(providerId, organizationId, authorization);
    this.validateBlockedTimes([dto]);

    const created = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.blockedTime.create({
        data: {
          organizationId,
          providerId,
          locationId: dto.locationId,
          startsAt: new Date(dto.startsAtIso),
          endsAt: new Date(dto.endsAtIso),
          reason: dto.reason,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: session.id,
          entityType: "blocked_time",
          entityId: entry.id,
          action: "created",
          newValue: { ...dto },
          description: "Provider blocked time created",
        },
      });

      return entry;
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId,
      providerId,
      locationId: dto.locationId,
    });

    return created;
  }

  async createRecurringBlock(
    providerId: string,
    organizationId: string,
    dto: RecurringBlockDto,
    authorization?: string,
  ) {
    const session = await this.requireScheduleAccess(providerId, organizationId, authorization);
    this.validateRecurringBlocks([dto]);

    const created = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.providerRecurringBlock.create({
        data: {
          organizationId,
          providerId,
          locationId: dto.locationId,
          dayOfWeek: dto.dayOfWeek,
          startsAtLocal: dto.startsAtLocal,
          endsAtLocal: dto.endsAtLocal,
          reason: dto.reason,
          isActive: dto.isActive,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: session.id,
          entityType: "provider_recurring_block",
          entityId: entry.id,
          action: "created",
          newValue: { ...dto },
          description: "Provider recurring block created",
        },
      });

      return entry;
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId,
      providerId,
      locationId: dto.locationId,
    });

    return created;
  }

  async updateRecurringBlock(
    providerId: string,
    entryId: string,
    organizationId: string,
    dto: RecurringBlockDto,
    authorization?: string,
  ) {
    const session = await this.requireScheduleAccess(providerId, organizationId, authorization);
    this.validateRecurringBlocks([dto]);

    const existing = await this.prisma.providerRecurringBlock.findFirst({
      where: { id: entryId, providerId, organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException("Recurring block entry not found");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.providerRecurringBlock.update({
        where: { id: entryId },
        data: {
          locationId: dto.locationId,
          dayOfWeek: dto.dayOfWeek,
          startsAtLocal: dto.startsAtLocal,
          endsAtLocal: dto.endsAtLocal,
          reason: dto.reason,
          isActive: dto.isActive,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: session.id,
          entityType: "provider_recurring_block",
          entityId: entry.id,
          action: "updated",
          newValue: { ...dto },
          description: "Provider recurring block updated",
        },
      });

      return entry;
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId,
      providerId,
      locationId: dto.locationId,
    });

    return updated;
  }

  async deleteRecurringBlock(
    providerId: string,
    entryId: string,
    organizationId: string,
    authorization?: string,
  ) {
    const session = await this.requireScheduleAccess(providerId, organizationId, authorization);
    const existing = await this.prisma.providerRecurringBlock.findFirst({
      where: { id: entryId, providerId, organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException("Recurring block entry not found");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: session.id,
          entityType: "provider_recurring_block",
          entityId: entryId,
          action: "deleted",
          description: "Provider recurring block deleted",
        },
      });

      await tx.providerRecurringBlock.delete({ where: { id: entryId } });
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId,
      providerId,
    });

    return { ok: true };
  }

  async updateBlockedTime(
    providerId: string,
    entryId: string,
    organizationId: string,
    dto: BlockedTimeDto,
    authorization?: string,
  ) {
    const session = await this.requireScheduleAccess(providerId, organizationId, authorization);
    this.validateBlockedTimes([dto]);

    const existing = await this.prisma.blockedTime.findFirst({
      where: { id: entryId, providerId, organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException("Blocked time entry not found");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.blockedTime.update({
        where: { id: entryId },
        data: {
          locationId: dto.locationId,
          startsAt: new Date(dto.startsAtIso),
          endsAt: new Date(dto.endsAtIso),
          reason: dto.reason,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: session.id,
          entityType: "blocked_time",
          entityId: entry.id,
          action: "updated",
          newValue: { ...dto },
          description: "Provider blocked time updated",
        },
      });

      return entry;
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId,
      providerId,
      locationId: dto.locationId,
    });

    return updated;
  }

  async deleteBlockedTime(
    providerId: string,
    entryId: string,
    organizationId: string,
    authorization?: string,
  ) {
    const session = await this.requireScheduleAccess(providerId, organizationId, authorization);
    const existing = await this.prisma.blockedTime.findFirst({
      where: { id: entryId, providerId, organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException("Blocked time entry not found");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: session.id,
          entityType: "blocked_time",
          entityId: entryId,
          action: "deleted",
          description: "Provider blocked time deleted",
        },
      });

      await tx.blockedTime.delete({ where: { id: entryId } });
    });

    this.scheduling.invalidateProviderSchedulePlanning({
      organizationId,
      providerId,
    });

    return { ok: true };
  }

  private async requireScheduleAccess(
    providerId: string,
    organizationId: string,
    authorization?: string,
  ) {
    const session = await this.auth.requireSession(authorization);
    const provider = await this.prisma.provider.findFirst({
      where: { id: providerId, organizationId },
      select: { id: true },
    });

    if (!provider) {
      throw new NotFoundException("Provider not found");
    }

    const isOwnerOrAdmin = isClinicAdmin(session);
    const ownsSchedule = session.providerId === providerId;
    if (!isOwnerOrAdmin && !ownsSchedule) {
      throw new ForbiddenException("You are not allowed to change this schedule");
    }
    if (session.organizationId !== organizationId) {
      throw new BadRequestException("Cross-organization schedule updates are not allowed");
    }

    return session;
  }

  private async requireScheduleViewAccess(
    providerId: string,
    organizationId: string,
    authorization?: string,
    locationId?: string,
  ) {
    const session = await this.auth.requireSession(authorization);
    if (locationId) assertClinicOperatorForLocation(session, locationId);
    else assertClinicOperator(session);

    if (session.organizationId !== organizationId) {
      throw new BadRequestException("Cross-organization schedule access is not allowed");
    }

    const provider = await this.prisma.provider.findFirst({
      where: { id: providerId, organizationId },
      select: { id: true },
    });

    if (!provider) {
      throw new NotFoundException("Provider not found");
    }

    return session;
  }

  private async requireScheduleGridViewAccess(
    organizationId: string,
    providerIds: string[] | undefined,
    authorization?: string,
    locationId?: string,
  ) {
    const session = await this.auth.requireSession(authorization);
    if (locationId) assertClinicOperatorForLocation(session, locationId);
    else assertClinicOperator(session);

    if (session.organizationId !== organizationId) {
      throw new BadRequestException("Cross-organization schedule access is not allowed");
    }

    return session;
  }

  private validateAvailabilityWindows(availability: AvailabilityWindowDto[]) {
    for (const item of availability) {
      if (this.inputTimeToMinutes(item.startsAtLocal) >= this.inputTimeToMinutes(item.endsAtLocal)) {
        throw new BadRequestException("Availability start time must be before end time");
      }
    }
  }

  private validateBlockedTimes(blockedTimes: BlockedTimeDto[]) {
    for (const item of blockedTimes) {
      const startsAt = new Date(item.startsAtIso);
      const endsAt = new Date(item.endsAtIso);
      if (startsAt >= endsAt) {
        throw new BadRequestException("Blocked time start must be before end");
      }
    }
  }

  private validateRecurringBlocks(recurringBlocks: RecurringBlockDto[]) {
    for (const item of recurringBlocks) {
      if (this.inputTimeToMinutes(item.startsAtLocal) >= this.inputTimeToMinutes(item.endsAtLocal)) {
        throw new BadRequestException("Recurring block start time must be before end time");
      }
    }
  }

  private async ensureAvailabilityEntryIsConflictFree(
    providerId: string,
    organizationId: string,
    dto: AvailabilityWindowDto,
    excludeId?: string,
  ) {
    const windows = await this.prisma.providerAvailability.findMany({
      where: {
        providerId,
        organizationId,
        dayOfWeek: dto.dayOfWeek,
        locationId: dto.locationId ?? null,
        id: excludeId ? { not: excludeId } : undefined,
      },
      select: {
        startsAtLocal: true,
        endsAtLocal: true,
      },
    });

    const start = this.inputTimeToMinutes(dto.startsAtLocal);
    const end = this.inputTimeToMinutes(dto.endsAtLocal);
    const overlaps = windows.some((window) => {
      const existingStart = this.inputTimeToMinutes(window.startsAtLocal);
      const existingEnd = this.inputTimeToMinutes(window.endsAtLocal);
      return start < existingEnd && end > existingStart;
    });

    if (overlaps) {
      throw new ConflictException("Availability windows cannot overlap for the same day");
    }
  }

  private inputTimeToMinutes(time: string) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }
}
