import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { mapStaffToClient } from "../../lib/map-staff";
import { AuthService, type AuthSession } from "../auth/auth.service";
import { assertClinicAdmin } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { CreateStaffDto } from "./dto/create-staff.dto";
import { ResetStaffPasswordDto } from "./dto/reset-staff-password.dto";
import { UpdateStaffDto } from "./dto/update-staff.dto";

@Injectable()
export class StaffService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async list(includeInactive = false, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    this.assertOrganizationStaffAdmin(session);
    const staff = await this.prisma.user.findMany({
      where: {
        organizationId: session.organizationId,
        status: includeInactive ? undefined : { not: "Inactive" },
      },
      include: {
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
    });

    return staff.map((item) => mapStaffToClient(item));
  }

  async getOne(id: string, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    this.assertOrganizationStaffAdmin(session);
    const staff = await this.prisma.user.findFirst({
      where: { id, organizationId: session.organizationId },
      include: {
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
    });

    if (!staff) {
      throw new NotFoundException("Staff account not found");
    }

    return mapStaffToClient(staff);
  }

  async create(dto: CreateStaffDto, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    this.assertOrganizationStaffAdmin(session);
    this.assertSameOrganization(session, dto.organizationId);
    this.assertCanManageOwnerRole(session, dto.role);

    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { organizationId: dto.organizationId, email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException("A staff account already exists for this email");
    }

    const passwordHash = await this.auth.hashPassword(dto.password);
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: dto.organizationId,
          name: dto.name,
          email,
          phone: dto.phone,
          role: dto.role,
          staffLabel: dto.staffLabel,
          department: dto.department,
          employeeCode: dto.employeeCode,
          licenseNumber: dto.licenseNumber,
          employmentType: dto.employmentType,
          startDate: dto.startDateIso ? new Date(dto.startDateIso) : undefined,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          notes: dto.notes,
          status: dto.status,
          isSchedulable: dto.isSchedulable,
          passwordHash,
        },
      });

      let providerId: string | undefined;
      if (dto.isSchedulable) {
        const provider = await tx.provider.create({
          data: {
            organizationId: dto.organizationId,
            userId: user.id,
            displayName: dto.name,
            roleLabel: dto.staffLabel,
            specialty: dto.specialty ?? dto.department ?? "",
            color: dto.color ?? "#2563eb",
            status: dto.providerStatus ?? "Available",
            availability: {
              createMany: {
                data: this.defaultAvailabilityRows(dto.organizationId),
              },
            },
          },
        });
        providerId = provider.id;
      }

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "staff_user",
          entityId: user.id,
          action: "created",
          description: `Staff account created${providerId ? " with schedule profile" : ""}`,
          newValue: {
            email,
            role: dto.role,
            staffLabel: dto.staffLabel,
            isSchedulable: dto.isSchedulable,
          },
        },
      });

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: {
          provider: {
            include: {
            availability: {
              orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }],
            },
            recurringBlocks: {
              orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }],
            },
            blockedTimes: { orderBy: { startsAt: "asc" } },
            providerServices: true,
          },
          },
        },
      });
    });

    return mapStaffToClient(created);
  }

  async update(id: string, dto: UpdateStaffDto, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    this.assertOrganizationStaffAdmin(session);
    this.assertSameOrganization(session, dto.organizationId);

    const existing = await this.prisma.user.findFirst({
      where: { id, organizationId: dto.organizationId },
      include: {
        provider: {
          include: {
            availability: true,
            blockedTimes: true,
            providerServices: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException("Staff account not found");
    }
    this.assertCanManageOwnerRole(session, existing.role);
    this.assertCanManageOwnerRole(session, dto.role);

    const email = dto.email.toLowerCase();
    const duplicate = await this.prisma.user.findFirst({
      where: {
        organizationId: dto.organizationId,
        email,
        id: { not: id },
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException("Another staff account already uses this email");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          name: dto.name,
          email,
          phone: dto.phone,
          role: dto.role,
          staffLabel: dto.staffLabel,
          department: dto.department,
          employeeCode: dto.employeeCode,
          licenseNumber: dto.licenseNumber,
          employmentType: dto.employmentType,
          startDate: dto.startDateIso ? new Date(dto.startDateIso) : null,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          notes: dto.notes,
          status: dto.status,
          isSchedulable: dto.isSchedulable,
        },
      });

      const appointmentCount = existing.provider
        ? await tx.appointment.count({ where: { providerId: existing.provider.id } })
        : 0;

      if (dto.isSchedulable) {
        if (existing.provider) {
          await tx.provider.update({
            where: { id: existing.provider.id },
            data: {
              displayName: dto.name,
              roleLabel: dto.staffLabel,
              specialty: dto.specialty ?? dto.department ?? "",
              color: dto.color ?? existing.provider.color,
              status: dto.providerStatus ?? existing.provider.status,
            },
          });
        } else {
          await tx.provider.create({
            data: {
              organizationId: dto.organizationId,
              userId: id,
              displayName: dto.name,
              roleLabel: dto.staffLabel,
              specialty: dto.specialty ?? dto.department ?? "",
              color: dto.color ?? "#2563eb",
              status: dto.providerStatus ?? "Available",
              availability: {
                createMany: {
                  data: this.defaultAvailabilityRows(dto.organizationId),
                },
              },
            },
          });
        }
      } else if (existing.provider) {
        if (appointmentCount > 0) {
          await tx.provider.update({
            where: { id: existing.provider.id },
            data: { status: "Inactive" },
          });
        } else {
          await tx.provider.delete({ where: { id: existing.provider.id } });
        }
      }

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "staff_user",
          entityId: id,
          action: "updated",
          description: "Staff account updated",
          newValue: {
            role: dto.role,
            staffLabel: dto.staffLabel,
            isSchedulable: dto.isSchedulable,
            status: dto.status,
          },
        },
      });

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: {
          provider: {
            include: {
            availability: {
              orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }],
            },
            recurringBlocks: {
              orderBy: [{ dayOfWeek: "asc" }, { startsAtLocal: "asc" }],
            },
            blockedTimes: { orderBy: { startsAt: "asc" } },
            providerServices: true,
          },
          },
        },
      });
    });

    return mapStaffToClient(updated);
  }

  async resetPassword(
    id: string,
    dto: ResetStaffPasswordDto,
    authorization?: string,
  ) {
    const session = await this.auth.requireSession(authorization);
    this.assertOrganizationStaffAdmin(session);

    const staff = await this.prisma.user.findFirst({
      where: { id, organizationId: session.organizationId },
      select: { id: true, organizationId: true, role: true },
    });

    if (!staff) {
      throw new NotFoundException("Staff account not found");
    }
    this.assertCanManageOwnerRole(session, staff.role);

    const passwordHash = await this.auth.hashPassword(dto.password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash },
      });
      await tx.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "password_reset" },
      });
      await tx.auditLog.create({
        data: {
          organizationId: staff.organizationId ?? session.organizationId,
          actorId: session.id,
          entityType: "staff_user",
          entityId: id,
          action: "password_reset",
          description: "Staff password updated and active sessions revoked by clinic administrator",
        },
      });
    });

    return { ok: true };
  }

  async deactivate(id: string, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    this.assertOrganizationStaffAdmin(session);

    const staff = await this.prisma.user.findFirst({
      where: { id, organizationId: session.organizationId },
      include: { provider: true },
    });

    if (!staff) {
      throw new NotFoundException("Staff account not found");
    }
    this.assertCanManageOwnerRole(session, staff.role);

    if (staff.role === "Owner") {
      const ownerCount = await this.prisma.user.count({
        where: {
          organizationId: session.organizationId,
          role: "Owner",
          status: "Active",
        },
      });

      if (ownerCount <= 1 && staff.status === "Active") {
        throw new BadRequestException("At least one active owner must remain");
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { status: "Inactive", isSchedulable: false },
      });

      if (staff.provider) {
        await tx.provider.update({
          where: { id: staff.provider.id },
          data: { status: "Inactive" },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: session.id,
          entityType: "staff_user",
          entityId: id,
          action: "deactivated",
          description: "Staff account deactivated",
        },
      });
    });

    return { ok: true };
  }

  async restore(id: string, authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    this.assertOrganizationStaffAdmin(session);

    const staff = await this.prisma.user.findFirst({
      where: { id, organizationId: session.organizationId },
      include: { provider: true },
    });

    if (!staff) {
      throw new NotFoundException("Staff account not found");
    }
    this.assertCanManageOwnerRole(session, staff.role);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          status: staff.status === "Invited" ? "Invited" : "Active",
          isSchedulable: Boolean(staff.provider),
        },
      });

      if (staff.provider) {
        await tx.provider.update({
          where: { id: staff.provider.id },
          data: {
            status: staff.provider.status === "Inactive" ? "Available" : staff.provider.status,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: session.id,
          entityType: "staff_user",
          entityId: id,
          action: "restored",
          description: "Staff account restored",
        },
      });
    });

    return { ok: true };
  }

  private assertSameOrganization(session: AuthSession, organizationId: string) {
    if (session.organizationId !== organizationId) {
      throw new BadRequestException("Cross-organization staff management is not allowed");
    }
  }

  private assertOrganizationStaffAdmin(session: AuthSession) {
    if (!session.effectiveRoleScopes) {
      assertClinicAdmin(session);
      return;
    }
    const allowed = session.effectiveRoleScopes.some(
      (scope) =>
        scope.locationId === null &&
        (scope.role === "Owner" || scope.role === "Admin"),
    );
    if (!allowed) {
      throw new ForbiddenException(
        "Organization-wide Owner or Admin access is required to manage clinic staff",
      );
    }
  }

  private assertCanManageOwnerRole(session: AuthSession, targetRole: string) {
    if (targetRole !== "Owner") return;

    const isOrganizationOwner = session.effectiveRoleScopes
      ? session.effectiveRoleScopes.some(
          (scope) => scope.locationId === null && scope.role === "Owner",
        )
      : session.role === "Owner";
    if (!isOrganizationOwner) {
      throw new ForbiddenException(
        "Only an organization Owner can manage Owner accounts",
      );
    }
  }

  private defaultAvailabilityRows(organizationId: string) {
    return [0, 1, 2, 3, 4, 5].map((dayOfWeek) => ({
      organizationId,
      dayOfWeek,
      startsAtLocal: "09:00",
      endsAtLocal: "17:00",
      slotDurationMinutes: 60,
      bufferMinutes: 0,
      isActive: dayOfWeek !== 6,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    }));
  }
}
