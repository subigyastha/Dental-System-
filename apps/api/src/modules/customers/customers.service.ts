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
import { MatchCustomersDto } from "./dto/match-customers.dto";
import { MergeCustomerDto } from "./dto/merge-customer.dto";
import { ResolveCustomerForAppointmentDto } from "./dto/resolve-customer-for-appointment.dto";
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
        ...(dto.patientCode
          ? {
              patientCode: dto.patientCode.trim().toUpperCase(),
            }
          : {
              id: "__no_patient_code_conflict__",
            }),
      },
      select: { id: true, patientCode: true },
    });

    if (existing) {
      throw new ConflictException("A patient with the same patient code already exists");
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

  async match(dto: MatchCustomersDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);

    const candidates = await this.prisma.customer.findMany({
      where: {
        organizationId: dto.organizationId,
        OR: [
          { phone: { contains: dto.phone } },
          { fullName: { contains: dto.name, mode: "insensitive" } },
          ...(dto.email ? [{ email: dto.email.toLowerCase() }] : []),
        ],
      },
      include: {
        dentalChart: true,
      },
      take: 12,
      orderBy: [{ updatedAt: "desc" }],
    });

    const scored = candidates
      .map((customer) => this.toCustomerMatch(customer, dto))
      .filter((match) => match.confidence !== "none")
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);

    return {
      matches: scored.map(({ score, ...match }) => match),
    };
  }

  async resolveForAppointment(
    dto: ResolveCustomerForAppointmentDto,
    authorization?: string,
  ) {
    const session = await this.requireOperator(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);

    if (dto.mode !== "create_new" && !dto.existingCustomerId) {
      throw new BadRequestException("Existing customer is required for this resolution mode");
    }

    if (dto.mode === "use_existing") {
      const existing = await this.prisma.customer.findFirst({
        where: {
          id: dto.existingCustomerId,
          organizationId: dto.organizationId,
        },
        include: {
          dentalChart: true,
        },
      });

      if (!existing) {
        throw new NotFoundException("Patient not found");
      }

      await this.prisma.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "customer",
          entityId: existing.id,
          action: "matched_existing_for_appointment",
          newValue: this.customerAuditPayload(dto, existing.patientCode ?? undefined),
          description: "Existing patient selected during appointment booking",
        },
      });

      return this.mapCustomer(existing);
    }

    if (dto.mode === "update_existing") {
      const existing = await this.prisma.customer.findFirst({
        where: {
          id: dto.existingCustomerId,
          organizationId: dto.organizationId,
        },
        include: {
          dentalChart: true,
        },
      });

      if (!existing) {
        throw new NotFoundException("Patient not found");
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.update({
          where: { id: existing.id },
          data: this.buildMergeFillData(existing, dto),
          include: {
            dentalChart: true,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId: dto.organizationId,
            actorId: session.id,
            entityType: "customer",
            entityId: existing.id,
            action: "updated_from_booking_resolution",
            newValue: this.customerAuditPayload(dto, customer.patientCode ?? undefined),
            description: "Existing patient updated from appointment booking",
          },
        });

        return customer;
      });

      return this.mapCustomer(updated);
    }

    return this.create(dto, authorization);
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
        ...(patientCode
          ? {
              patientCode,
            }
          : {
              id: "__no_patient_code_conflict__",
            }),
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException("Another patient already uses this patient code");
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

  async merge(id: string, dto: MergeCustomerDto, authorization?: string) {
    const session = await this.requireOperator(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);

    if (id === dto.secondaryCustomerId) {
      throw new BadRequestException("Primary and duplicate patient cannot be the same record");
    }

    const [primary, secondary] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id, organizationId: dto.organizationId },
        include: { dentalChart: true },
      }),
      this.prisma.customer.findFirst({
        where: { id: dto.secondaryCustomerId, organizationId: dto.organizationId },
        include: { dentalChart: true },
      }),
    ]);

    if (!primary || !secondary) {
      throw new NotFoundException("One or both patient records were not found");
    }

    const merged = await this.prisma.$transaction(async (tx) => {
      const primaryAfterFill = await tx.customer.update({
        where: { id: primary.id },
        data: this.buildMergeFillData(primary, secondary),
        include: { dentalChart: true },
      });

      await Promise.all([
        tx.appointment.updateMany({
          where: { customerId: secondary.id },
          data: { customerId: primary.id },
        }),
        tx.appointmentSession.updateMany({
          where: { customerId: secondary.id },
          data: { customerId: primary.id },
        }),
        tx.followUpTask.updateMany({
          where: { customerId: secondary.id },
          data: { customerId: primary.id },
        }),
        tx.communicationLog.updateMany({
          where: { customerId: secondary.id },
          data: { customerId: primary.id },
        }),
        tx.invoice.updateMany({
          where: { customerId: secondary.id },
          data: { customerId: primary.id },
        }),
        tx.payment.updateMany({
          where: { customerId: secondary.id },
          data: { customerId: primary.id },
        }),
        tx.dentalChartRevision.updateMany({
          where: { customerId: secondary.id },
          data: { customerId: primary.id },
        }),
      ]);

      if (secondary.dentalChart) {
        if (!primaryAfterFill.dentalChart) {
          await tx.patientDentalChart.update({
            where: { id: secondary.dentalChart.id },
            data: {
              customerId: primary.id,
            },
          });
        } else {
          await tx.dentalChartRevision.create({
            data: {
              customerId: primary.id,
              chartData: secondary.dentalChart.chartData as Prisma.InputJsonValue,
              note: `Merged duplicate chart from ${secondary.fullName}`,
            },
          });
          await tx.patientDentalChart.delete({
            where: { id: secondary.dentalChart.id },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "customer",
          entityId: primary.id,
          action: "merged_duplicate",
          oldValue: {
            secondaryCustomerId: secondary.id,
            secondaryName: secondary.fullName,
          },
          description: "Duplicate patient merged into primary patient record",
        },
      });

      await tx.customer.delete({
        where: { id: secondary.id },
      });

      return tx.customer.findUniqueOrThrow({
        where: { id: primary.id },
        include: { dentalChart: true },
      });
    });

    return this.mapCustomer(merged);
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
      age: customer.dateOfBirth ? this.getAge(customer.dateOfBirth) : 0,
      gender: customer.gender ?? undefined,
      dateOfBirthIso: customer.dateOfBirth?.toISOString(),
      address: customer.address ?? undefined,
      emergencyContactName: customer.emergencyContactName ?? undefined,
      emergencyContactPhone: customer.emergencyContactPhone ?? undefined,
      allergies: customer.allergies ?? undefined,
      medicalNotes: customer.medicalNotes ?? undefined,
      risk: customer.riskLabel,
      lastVisitIso: (customer.lastVisitAt ?? customer.updatedAt).toISOString(),
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

  private getAge(date: Date) {
    const today = new Date();
    let age = today.getFullYear() - date.getFullYear();
    const monthDelta = today.getMonth() - date.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < date.getDate())) {
      age -= 1;
    }
    return age;
  }

  private normalizePhone(phone: string) {
    return phone.replace(/\D+/g, "");
  }

  private normalizeName(name: string) {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private toCustomerMatch(
    customer: {
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
    },
    candidate: Pick<MatchCustomersDto, "name" | "phone" | "email">,
  ) {
    const normalizedPhone = this.normalizePhone(candidate.phone);
    const normalizedExistingPhone = this.normalizePhone(customer.phone);
    const normalizedName = this.normalizeName(candidate.name);
    const normalizedExistingName = this.normalizeName(customer.fullName);

    let score = 0;
    let confidence: "strong" | "moderate" | "weak" | "none" = "none";

    if (normalizedPhone && normalizedPhone === normalizedExistingPhone) {
      score += 100;
    } else if (
      normalizedPhone &&
      normalizedExistingPhone &&
      (normalizedExistingPhone.endsWith(normalizedPhone) ||
        normalizedPhone.endsWith(normalizedExistingPhone))
    ) {
      score += 55;
    }

    if (normalizedName && normalizedName === normalizedExistingName) {
      score += 40;
    } else if (
      normalizedName &&
      normalizedExistingName &&
      (normalizedExistingName.includes(normalizedName) ||
        normalizedName.includes(normalizedExistingName))
    ) {
      score += 22;
    }

    if (
      candidate.email &&
      customer.email &&
      candidate.email.toLowerCase() === customer.email.toLowerCase()
    ) {
      score += 25;
    }

    if (score >= 100) {
      confidence = "strong";
    } else if (score >= 45) {
      confidence = "moderate";
    } else if (score >= 20) {
      confidence = "weak";
    }

    return {
      score,
      confidence,
      customer: this.mapCustomer(customer),
    };
  }

  private buildMergeFillData(
    primary: {
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
    },
    incoming:
      | ResolveCustomerForAppointmentDto
      | {
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
        },
  ) {
    const incomingEmail = "email" in incoming ? incoming.email ?? null : null;
    const incomingGender = "gender" in incoming ? incoming.gender ?? null : null;
    const incomingDob = "dateOfBirthIso" in incoming
      ? (incoming.dateOfBirthIso ? new Date(incoming.dateOfBirthIso) : null)
      : ("dateOfBirth" in incoming ? incoming.dateOfBirth ?? null : null);

    const incomingName = "name" in incoming ? incoming.name : incoming.fullName;
    const incomingPatientCode =
      "patientCode" in incoming ? incoming.patientCode ?? null : incoming.patientCode ?? null;
    const incomingAddress = "address" in incoming ? incoming.address ?? null : null;
    const incomingEmergencyName =
      "emergencyContactName" in incoming ? incoming.emergencyContactName ?? null : null;
    const incomingEmergencyPhone =
      "emergencyContactPhone" in incoming ? incoming.emergencyContactPhone ?? null : null;
    const incomingAllergies = "allergies" in incoming ? incoming.allergies ?? null : null;
    const incomingMedicalNotes =
      "medicalNotes" in incoming ? incoming.medicalNotes ?? null : null;
    const incomingRisk = "risk" in incoming ? incoming.risk : incoming.riskLabel;

    return {
      fullName: primary.fullName || incomingName,
      patientCode: primary.patientCode ?? incomingPatientCode,
      phone: primary.phone || incoming.phone,
      email: primary.email ?? incomingEmail,
      gender: primary.gender ?? incomingGender,
      dateOfBirth: primary.dateOfBirth ?? incomingDob,
      address: primary.address ?? incomingAddress,
      emergencyContactName: primary.emergencyContactName ?? incomingEmergencyName,
      emergencyContactPhone: primary.emergencyContactPhone ?? incomingEmergencyPhone,
      allergies: primary.allergies ?? incomingAllergies,
      medicalNotes: primary.medicalNotes ?? incomingMedicalNotes,
      riskLabel:
        primary.riskLabel === "Routine" && incomingRisk !== "Routine"
          ? incomingRisk
          : primary.riskLabel,
    };
  }
}
