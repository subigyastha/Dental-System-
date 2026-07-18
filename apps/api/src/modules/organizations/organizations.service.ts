import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import { assertClinicAdmin } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateOrganizationDto } from "./dto/update-organization.dto";

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async update(id: string, dto: UpdateOrganizationDto, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicAdmin(session);
    if (id !== session.organizationId) {
      throw new NotFoundException("Organization not found");
    }

    const existing = await this.prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException("Organization not found");
    }

    const organization = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id },
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          address: dto.address,
          primaryCalendar: dto.primaryCalendar,
          settings: {
            upsert: {
              create: {
                defaultBufferMinutes: dto.defaultBufferMinutes,
                reminderLeadMinutes: dto.reminderLeadMinutes,
                businessDayStartsAt: dto.businessDayStartsAt,
                businessDayEndsAt: dto.businessDayEndsAt,
                allowOverlaps: dto.allowOverlaps,
              },
              update: {
                defaultBufferMinutes: dto.defaultBufferMinutes,
                reminderLeadMinutes: dto.reminderLeadMinutes,
                businessDayStartsAt: dto.businessDayStartsAt,
                businessDayEndsAt: dto.businessDayEndsAt,
                allowOverlaps: dto.allowOverlaps,
              },
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: id,
          entityType: "organization",
          entityId: id,
          action: "updated",
          newValue: { ...dto },
          description: "Organization settings updated",
        },
      });

      return updated;
    });

    return { id: organization.id };
  }
}
