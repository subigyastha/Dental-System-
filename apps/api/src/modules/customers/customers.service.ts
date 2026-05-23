import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AuthService } from "../auth/auth.service";
import { assertClinicOperator } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";
import { UpsertVisitReportDto } from "./dto/upsert-visit-report.dto";

@Injectable()
export class CustomersService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async list(authorization?: string) {
    const session = await this.requireOperator(authorization);
    const customers = await this.prisma.customer.findMany({
      where: { organizationId: session.organizationId },
      include: {
        dentalChart: true,
      },
      orderBy: [{ fullName: "asc" }],
    });

    return customers.map((customer) => this.mapCustomer(customer));
  }

  async getOne(id: string, authorization?: string) {
    const session = await this.requireOperator(authorization);
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: session.organizationId },
      include: {
        dentalChart: true,
      },
    });

    if (!customer) {
      throw new NotFoundException("Patient not found");
    }

    return this.mapCustomer(customer);
  }

  async create(dto: CreateCustomerDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);

    const existing = await this.prisma.customer.findFirst({
      where: {
        organizationId: dto.organizationId,
        OR: [
          { phone: dto.phone },
          ...(dto.email ? [{ email: dto.email.toLowerCase() }] : []),
          ...(dto.patientCode ? [{ patientCode: dto.patientCode.trim().toUpperCase() }] : []),
        ],
      },
      select: { id: true, phone: true, email: true, patientCode: true },
    });

    if (existing) {
      throw new ConflictException("A patient with the same phone, email, or patient code already exists");
    }

    const customer = await this.prisma.$transaction(async (tx) => {
      const patientCode =
        dto.patientCode?.trim().toUpperCase() ??
        (await this.generatePatientCode(tx, dto.organizationId));

      const created = await tx.customer.create({
        data: {
          id: dto.id,
          organizationId: dto.organizationId,
          fullName: dto.name,
          patientCode,
          phone: dto.phone,
          email: dto.email?.toLowerCase(),
          gender: dto.gender,
          dateOfBirth: dto.dateOfBirthIso ? new Date(dto.dateOfBirthIso) : undefined,
          address: dto.address,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          allergies: dto.allergies,
          medicalNotes: dto.medicalNotes,
          riskLabel: dto.risk,
          dentalChart: {
            create: {
              chartData: this.defaultDentalChartPayload(),
              version: 1,
            },
          },
        },
        include: {
          dentalChart: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "customer",
          entityId: created.id,
          action: "created",
          newValue: this.customerAuditPayload(dto, patientCode),
          description: "Patient profile created",
        },
      });

      return created;
    });

    return this.mapCustomer(customer);
  }

  async update(id: string, dto: UpdateCustomerDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);

    const existing = await this.prisma.customer.findFirst({
      where: { id, organizationId: dto.organizationId },
    });

    if (!existing) {
      throw new NotFoundException("Patient not found");
    }

    const patientCode = dto.patientCode?.trim().toUpperCase() ?? existing.patientCode ?? undefined;
    const duplicate = await this.prisma.customer.findFirst({
      where: {
        organizationId: dto.organizationId,
        id: { not: id },
        OR: [
          { phone: dto.phone },
          ...(dto.email ? [{ email: dto.email.toLowerCase() }] : []),
          ...(patientCode ? [{ patientCode }] : []),
        ],
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException("Another patient already uses this phone, email, or patient code");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id },
        data: {
          fullName: dto.name,
          patientCode,
          phone: dto.phone,
          email: dto.email?.toLowerCase() ?? null,
          gender: dto.gender ?? null,
          dateOfBirth: dto.dateOfBirthIso ? new Date(dto.dateOfBirthIso) : null,
          address: dto.address ?? null,
          emergencyContactName: dto.emergencyContactName ?? null,
          emergencyContactPhone: dto.emergencyContactPhone ?? null,
          allergies: dto.allergies ?? null,
          medicalNotes: dto.medicalNotes ?? null,
          riskLabel: dto.risk,
        },
        include: {
          dentalChart: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "customer",
          entityId: customer.id,
          action: "updated",
          newValue: this.customerAuditPayload(dto, patientCode),
          description: "Patient profile updated",
        },
      });

      return customer;
    });

    return this.mapCustomer(updated);
  }

  async delete(id: string, authorization?: string) {
    const session = await this.requireOperator(authorization);
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: session.organizationId },
      select: { id: true, organizationId: true },
    });

    if (!customer) {
      throw new NotFoundException("Patient not found");
    }

    const [appointments, reports, followUps, communications, invoices, payments] =
      await Promise.all([
        this.prisma.appointment.count({ where: { customerId: id } }),
        this.prisma.appointmentSession.count({ where: { customerId: id } }),
        this.prisma.followUpTask.count({ where: { customerId: id } }),
        this.prisma.communicationLog.count({ where: { customerId: id } }),
        this.prisma.invoice.count({ where: { customerId: id } }),
        this.prisma.payment.count({ where: { customerId: id } }),
      ]);

    if (appointments || reports || followUps || communications || invoices || payments) {
      throw new BadRequestException(
        "Patient cannot be deleted because operational or financial records already exist",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId: customer.organizationId,
          actorId: session.id,
          entityType: "customer",
          entityId: customer.id,
          action: "deleted",
          description: "Patient profile deleted",
        },
      });

      await tx.customer.delete({ where: { id } });
    });

    return { ok: true };
  }

  async listVisitReports(customerId: string, authorization?: string) {
    const session = await this.requireOperator(authorization);
    await this.assertCustomerAccess(customerId, session.organizationId);

    const reports = await this.prisma.appointmentSession.findMany({
      where: { customerId, appointment: { organizationId: session.organizationId } },
      include: {
        appointment: {
          select: {
            id: true,
            startsAt: true,
            organizationId: true,
          },
        },
        dentalChartRevision: true,
      },
      orderBy: { appointment: { startsAt: "desc" } },
    });

    return reports.map((report) => this.mapVisitReport(report));
  }

  async getVisitReport(customerId: string, reportId: string, authorization?: string) {
    const session = await this.requireOperator(authorization);
    await this.assertCustomerAccess(customerId, session.organizationId);

    const report = await this.prisma.appointmentSession.findFirst({
      where: {
        id: reportId,
        customerId,
        appointment: { organizationId: session.organizationId },
      },
      include: {
        appointment: {
          select: {
            id: true,
            startsAt: true,
            organizationId: true,
          },
        },
        dentalChartRevision: true,
      },
    });

    if (!report) {
      throw new NotFoundException("Visit report not found");
    }

    return this.mapVisitReport(report);
  }

  async upsertVisitReport(customerId: string, dto: UpsertVisitReportDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);
    await this.assertCustomerAccess(customerId, session.organizationId);

    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: dto.appointmentId,
        organizationId: dto.organizationId,
        customerId,
      },
      include: {
        services: {
          select: {
            serviceId: true,
          },
        },
        session: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException("Visit appointment not found for patient");
    }

    if (appointment.providerId !== dto.providerId) {
      throw new BadRequestException("Visit report provider must match the scheduled provider");
    }

    const serviceId = dto.serviceId ?? appointment.services[0]?.serviceId;
    if (!serviceId) {
      throw new BadRequestException("Visit report requires at least one service");
    }

    if (dto.updateDentalChart && !dto.chartData) {
      throw new BadRequestException("Chart data is required when updating the dental chart");
    }

    const report = await this.prisma.$transaction(async (tx) => {
      const sessionRow = await tx.appointmentSession.upsert({
        where: { appointmentId: appointment.id },
        update: {
          providerId: dto.providerId,
          serviceId,
          visitSummary: dto.visitSummary,
          symptoms: dto.symptoms,
          clinicalNotes: dto.clinicalNotes,
          doctorNotes: dto.doctorNotes,
          followUpRequired: dto.followUpRequired,
          followUpDate: dto.followUpDateIso
            ? new Date(dto.followUpDateIso)
            : null,
          dentalChartUpdated: dto.updateDentalChart,
          chartNote: dto.chartNote ?? null,
        },
        create: {
          appointmentId: appointment.id,
          customerId,
          providerId: dto.providerId,
          serviceId,
          visitSummary: dto.visitSummary,
          symptoms: dto.symptoms,
          clinicalNotes: dto.clinicalNotes,
          doctorNotes: dto.doctorNotes,
          followUpRequired: dto.followUpRequired,
          followUpDate: dto.followUpDateIso
            ? new Date(dto.followUpDateIso)
            : null,
          dentalChartUpdated: dto.updateDentalChart,
          chartNote: dto.chartNote ?? null,
        },
      });

      if (dto.updateDentalChart && dto.chartData) {
        const currentChart = await tx.patientDentalChart.findUnique({
          where: { customerId },
          select: {
            id: true,
            version: true,
          },
        });

        await tx.patientDentalChart.upsert({
          where: { customerId },
          update: {
            chartData: dto.chartData as Prisma.InputJsonObject,
            version: (currentChart?.version ?? 0) + 1,
            updatedByProviderId: dto.providerId,
            sourceAppointmentSessionId: sessionRow.id,
          },
          create: {
            customerId,
            chartData: dto.chartData as Prisma.InputJsonObject,
            version: 1,
            updatedByProviderId: dto.providerId,
            sourceAppointmentSessionId: sessionRow.id,
          },
        });

        await tx.dentalChartRevision.upsert({
          where: { appointmentSessionId: sessionRow.id },
          update: {
            chartData: dto.chartData as Prisma.InputJsonObject,
            createdByProviderId: dto.providerId,
            note: dto.chartNote ?? null,
          },
          create: {
            customerId,
            appointmentSessionId: sessionRow.id,
            createdByProviderId: dto.providerId,
            chartData: dto.chartData as Prisma.InputJsonObject,
            note: dto.chartNote ?? null,
          },
        });
      }

      await tx.customer.update({
        where: { id: customerId },
        data: { lastVisitAt: appointment.startsAt },
      });

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "appointment_session",
          entityId: sessionRow.id,
          action: appointment.session ? "updated" : "created",
          newValue: {
            appointmentId: dto.appointmentId,
            providerId: dto.providerId,
            serviceId,
            visitSummary: dto.visitSummary,
            followUpRequired: dto.followUpRequired,
            followUpDateIso: dto.followUpDateIso,
            dentalChartUpdated: dto.updateDentalChart,
          } as Prisma.InputJsonObject,
          description: "Visit report saved from patient workspace",
        },
      });

      return tx.appointmentSession.findUniqueOrThrow({
        where: { id: sessionRow.id },
        include: {
          appointment: {
            select: {
              id: true,
              organizationId: true,
              startsAt: true,
            },
          },
          dentalChartRevision: true,
        },
      });
    });

    return this.mapVisitReport(report);
  }

  async deleteVisitReport(customerId: string, reportId: string, authorization?: string) {
    const session = await this.requireOperator(authorization);
    await this.assertCustomerAccess(customerId, session.organizationId);

    const report = await this.prisma.appointmentSession.findFirst({
      where: {
        id: reportId,
        customerId,
        appointment: { organizationId: session.organizationId },
      },
      include: {
        appointment: {
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!report) {
      throw new NotFoundException("Visit report not found");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId: report.appointment.organizationId,
          actorId: session.id,
          entityType: "appointment_session",
          entityId: report.id,
          action: "deleted",
          description: "Visit report removed",
        },
      });

      await tx.appointmentSession.delete({
        where: { id: report.id },
      });
    });

    return { ok: true };
  }

  private async requireOperator(authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertClinicOperator(session.role);
    return session;
  }

  private assertSameOrganization(sessionOrganizationId: string, targetOrganizationId: string) {
    if (sessionOrganizationId !== targetOrganizationId) {
      throw new BadRequestException("Cross-organization access is not allowed");
    }
  }

  private async assertCustomerAccess(customerId: string, organizationId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException("Patient not found");
    }
  }

  private async generatePatientCode(tx: Prisma.TransactionClient, organizationId: string) {
    const existingCodes = await tx.customer.findMany({
      where: {
        organizationId,
        patientCode: { not: null },
      },
      select: { patientCode: true },
      orderBy: { patientCode: "desc" },
      take: 100,
    });

    const nextNumber =
      existingCodes.reduce((max, item) => {
        const match = item.patientCode?.match(/^PT-(\d+)$/);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1;

    return `PT-${String(nextNumber).padStart(4, "0")}`;
  }

  private customerAuditPayload(
    dto: CreateCustomerDto | UpdateCustomerDto,
    patientCode?: string,
  ): Prisma.InputJsonObject {
    return {
      name: dto.name,
      patientCode: patientCode ?? null,
      phone: dto.phone,
      email: dto.email ?? null,
      gender: dto.gender ?? null,
      dateOfBirthIso: dto.dateOfBirthIso ?? null,
      address: dto.address ?? null,
      emergencyContactName: dto.emergencyContactName ?? null,
      emergencyContactPhone: dto.emergencyContactPhone ?? null,
      allergies: dto.allergies ?? null,
      medicalNotes: dto.medicalNotes ?? null,
      risk: dto.risk,
    };
  }

  private mapCustomer(customer: {
    id: string;
    organizationId: string;
    fullName: string;
    patientCode: string | null;
    phone: string;
    email: string | null;
    gender: string | null;
    dateOfBirth: Date | null;
    address: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    allergies: string | null;
    medicalNotes: string | null;
    riskLabel: string;
    lastVisitAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    dentalChart?: {
      id: string;
      chartData: Prisma.JsonValue;
      version: number;
      updatedAt: Date;
    } | null;
  }) {
    return {
      id: customer.id,
      organizationId: customer.organizationId,
      name: customer.fullName,
      patientCode: customer.patientCode ?? undefined,
      phone: customer.phone,
      email: customer.email ?? undefined,
      gender: customer.gender ?? undefined,
      dateOfBirthIso: customer.dateOfBirth?.toISOString(),
      address: customer.address ?? undefined,
      emergencyContactName: customer.emergencyContactName ?? undefined,
      emergencyContactPhone: customer.emergencyContactPhone ?? undefined,
      allergies: customer.allergies ?? undefined,
      medicalNotes: customer.medicalNotes ?? undefined,
      risk: customer.riskLabel,
      lastVisitAtIso: customer.lastVisitAt?.toISOString(),
      createdAtIso: customer.createdAt.toISOString(),
      updatedAtIso: customer.updatedAt.toISOString(),
      dentalChart: customer.dentalChart
        ? {
            id: customer.dentalChart.id,
            chartData: customer.dentalChart.chartData,
            version: customer.dentalChart.version,
            updatedAtIso: customer.dentalChart.updatedAt.toISOString(),
          }
        : undefined,
    };
  }

  private mapVisitReport(report: {
    id: string;
    appointmentId: string;
    customerId: string;
    providerId: string;
    serviceId: string;
    visitSummary: string | null;
    symptoms: string | null;
    clinicalNotes: string | null;
    doctorNotes: string | null;
    followUpRequired: boolean;
    followUpDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
    dentalChartUpdated: boolean;
    chartNote: string | null;
    dentalChartRevision?: {
      id: string;
      chartData: Prisma.JsonValue;
      note: string | null;
      createdAt: Date;
    } | null;
    appointment: {
      id: string;
      organizationId: string;
      startsAt: Date;
    };
  }) {
    return {
      id: report.id,
      appointmentId: report.appointmentId,
      customerId: report.customerId,
      providerId: report.providerId,
      serviceId: report.serviceId,
      appointmentStartsAtIso: report.appointment.startsAt.toISOString(),
      createdAtIso: report.createdAt.toISOString(),
      updatedAtIso: report.updatedAt.toISOString(),
      visitSummary: report.visitSummary ?? "",
      symptoms: report.symptoms ?? undefined,
      clinicalNotes: report.clinicalNotes ?? undefined,
      doctorNotes: report.doctorNotes ?? undefined,
      followUpRequired: report.followUpRequired,
      followUpDateIso: report.followUpDate?.toISOString(),
      dentalChartUpdated: report.dentalChartUpdated,
      chartNote: report.chartNote ?? undefined,
      dentalChartRevision: report.dentalChartRevision
        ? {
            id: report.dentalChartRevision.id,
            chartData: report.dentalChartRevision.chartData,
            note: report.dentalChartRevision.note ?? undefined,
            createdAtIso: report.dentalChartRevision.createdAt.toISOString(),
          }
        : undefined,
    };
  }

  private defaultDentalChartPayload(): Prisma.InputJsonObject {
    return {
      segments: [],
      notes: [],
      version: 1,
    };
  }
}
