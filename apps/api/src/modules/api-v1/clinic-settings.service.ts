import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import {
  AuthService,
  type AuthSession,
  type AuthSessionReference,
} from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import type { UpdateClinicSettingsDto } from "./dto/clinic-settings.dto";

const SETTINGS_ROLES = new Set(["Owner", "Admin"]);

@Injectable()
export class ClinicSettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
  ) {}

  async get(authorization?: AuthSessionReference) {
    const actor = await this.requireSettingsActor(authorization);
    const organization = await this.prisma.organization.findFirst({
      where: { id: actor.organizationId, status: "Active" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        timezone: true,
        settings: {
          select: {
            businessDayStartsAt: true,
            businessDayEndsAt: true,
            defaultBufferMinutes: true,
            bookingHoldMinutes: true,
            slotStartIntervalMinutes: true,
            scheduleConfigurationVersion: true,
            reminderLeadMinutes: true,
          },
        },
      },
    });
    if (!organization) throw new NotFoundException("Organization not found");
    return this.mapSettings(organization, this.isOrganizationOwner(actor));
  }

  async update(
    dto: UpdateClinicSettingsDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.requireSettingsActor(authorization);
    if (dto.businessDayStartsAt >= dto.businessDayEndsAt) {
      throw new BadRequestException("Business day end must be after its start");
    }

    const existing = await this.prisma.organization.findFirst({
      where: { id: actor.organizationId, status: "Active" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        timezone: true,
        settings: {
          select: {
            businessDayStartsAt: true,
            businessDayEndsAt: true,
            defaultBufferMinutes: true,
            bookingHoldMinutes: true,
            slotStartIntervalMinutes: true,
            scheduleConfigurationVersion: true,
            reminderLeadMinutes: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException("Organization not found");

    const priorInterval = existing.settings?.slotStartIntervalMinutes ?? 15;
    if (
      dto.slotStartIntervalMinutes !== priorInterval &&
      !this.isOrganizationOwner(actor)
    ) {
      throw new ForbiddenException(
        "Only an organization Owner can change the offered slot interval",
      );
    }
    const scheduleChanged =
      dto.slotStartIntervalMinutes !== priorInterval ||
      dto.businessDayStartsAt !==
        (existing.settings?.businessDayStartsAt ?? "08:00") ||
      dto.businessDayEndsAt !==
        (existing.settings?.businessDayEndsAt ?? "18:00") ||
      dto.defaultBufferMinutes !==
        (existing.settings?.defaultBufferMinutes ?? 10);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: actor.organizationId },
        data: {
          name: dto.name.trim(),
          email: dto.email?.trim() || null,
          phone: dto.phone?.trim() || null,
          address: dto.address?.trim() || null,
          primaryCalendar: "AD",
          settings: {
            upsert: {
              create: {
                businessDayStartsAt: dto.businessDayStartsAt,
                businessDayEndsAt: dto.businessDayEndsAt,
                defaultBufferMinutes: dto.defaultBufferMinutes,
                bookingHoldMinutes: dto.bookingHoldMinutes,
                slotStartIntervalMinutes: dto.slotStartIntervalMinutes,
                scheduleConfigurationVersion: 1,
                reminderLeadMinutes: dto.reminderLeadMinutes,
                allowOverlaps: false,
              },
              update: {
                businessDayStartsAt: dto.businessDayStartsAt,
                businessDayEndsAt: dto.businessDayEndsAt,
                defaultBufferMinutes: dto.defaultBufferMinutes,
                bookingHoldMinutes: dto.bookingHoldMinutes,
                slotStartIntervalMinutes: dto.slotStartIntervalMinutes,
                reminderLeadMinutes: dto.reminderLeadMinutes,
                allowOverlaps: false,
                ...(scheduleChanged
                  ? { scheduleConfigurationVersion: { increment: 1 } }
                  : {}),
              },
            },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "organization_settings",
          entityId: actor.organizationId,
          action: "updated",
          description: scheduleChanged
            ? "Clinic settings and schedule configuration updated"
            : "Clinic settings updated",
          oldValue: {
            name: existing.name,
            email: existing.email,
            phone: existing.phone,
            address: existing.address,
            settings: existing.settings,
          },
          newValue: {
            ...dto,
            primaryCalendar: "AD",
            allowOverlaps: false,
          },
        },
      });
      return tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          timezone: true,
          settings: {
            select: {
              businessDayStartsAt: true,
              businessDayEndsAt: true,
              defaultBufferMinutes: true,
              bookingHoldMinutes: true,
              slotStartIntervalMinutes: true,
              scheduleConfigurationVersion: true,
              reminderLeadMinutes: true,
            },
          },
        },
      });
    });

    if (scheduleChanged) {
      this.scheduling.invalidateOrganizationSchedulePlanning(
        actor.organizationId,
      );
    }
    return this.mapSettings(updated, this.isOrganizationOwner(actor));
  }

  private async requireSettingsActor(
    authorization?: AuthSessionReference,
  ): Promise<AuthSession> {
    const actor = await this.auth.requireSession(authorization);
    const allowed = actor.effectiveRoleScopes
      ? actor.effectiveRoleScopes.some(
          (scope) =>
            scope.locationId === null && SETTINGS_ROLES.has(scope.role),
        )
      : SETTINGS_ROLES.has(actor.role);
    if (!allowed) {
      throw new ForbiddenException(
        "Organization-wide Owner or Admin access is required for clinic settings",
      );
    }
    return actor;
  }

  private isOrganizationOwner(actor: AuthSession) {
    return actor.effectiveRoleScopes
      ? actor.effectiveRoleScopes.some(
          (scope) => scope.locationId === null && scope.role === "Owner",
        )
      : actor.role === "Owner";
  }

  private mapSettings(
    organization: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
      timezone: string;
      settings: {
        businessDayStartsAt: string;
        businessDayEndsAt: string;
        defaultBufferMinutes: number;
        bookingHoldMinutes: number;
        slotStartIntervalMinutes: number;
        scheduleConfigurationVersion: number;
        reminderLeadMinutes: number;
      } | null;
    },
    canManageSlotInterval: boolean,
  ) {
    return {
      capabilities: { canEdit: true, canManageSlotInterval },
      organization: {
        id: organization.id,
        name: organization.name,
        email: organization.email,
        phone: organization.phone,
        address: organization.address,
        timezone: organization.timezone,
        primaryCalendar: "AD" as const,
      },
      scheduling: {
        businessDayStartsAt:
          organization.settings?.businessDayStartsAt ?? "08:00",
        businessDayEndsAt:
          organization.settings?.businessDayEndsAt ?? "18:00",
        defaultBufferMinutes:
          organization.settings?.defaultBufferMinutes ?? 10,
        bookingHoldMinutes: organization.settings?.bookingHoldMinutes ?? 3,
        slotStartIntervalMinutes:
          organization.settings?.slotStartIntervalMinutes ?? 15,
        scheduleConfigurationVersion:
          organization.settings?.scheduleConfigurationVersion ?? 1,
        reminderLeadMinutes:
          organization.settings?.reminderLeadMinutes ?? 1440,
        allowOverlaps: false as const,
      },
    };
  }
}
