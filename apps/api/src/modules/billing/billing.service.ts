import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  type FinancialCorrection,
  type Invoice,
  type Payment,
} from "@prisma/client";

import { AuthService } from "../auth/auth.service";
import { assertFinanceOperator, effectiveRoleUnion, financeRoles } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import { CreateInvoiceDto } from "./dto/create-invoice.dto";
import { InvoiceLineItemDto } from "./dto/invoice-line-item.dto";
import { ListInvoicesDto } from "./dto/list-invoices.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";
import { UpdateInvoiceDto } from "./dto/update-invoice.dto";
import { CreateFinancialCorrectionDto } from "./dto/create-financial-correction.dto";

@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async listInvoices(query: ListInvoicesDto, authorization?: string) {
    const session = await this.requireFinance(authorization);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId: session.organizationId,
        ...(this.financeLocationWhere(session)
          ? { locationId: this.financeLocationWhere(session) }
          : {}),
        customerId: query.customerId,
        appointmentId: query.appointmentId,
        status: query.status as InvoiceStatus | undefined,
      },
      include: {
        lineItems: { orderBy: [{ sortOrder: "asc" }] },
        payments: { orderBy: [{ paidAt: "desc" }] },
        corrections: { orderBy: [{ executedAt: "desc" }] },
      },
      orderBy: [{ issuedAt: "desc" }],
    });

    return invoices.map((invoice) => this.mapInvoice(invoice));
  }

  async getInvoice(id: string, authorization?: string) {
    const session = await this.requireFinance(authorization);
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id,
        organizationId: session.organizationId,
        ...(this.financeLocationWhere(session)
          ? { locationId: this.financeLocationWhere(session) }
          : {}),
      },
      include: {
        lineItems: { orderBy: [{ sortOrder: "asc" }] },
        payments: { orderBy: [{ paidAt: "desc" }] },
        corrections: { orderBy: [{ executedAt: "desc" }] },
      },
    });

    if (!invoice) {
      throw new NotFoundException("Invoice not found");
    }

    return this.mapInvoice(invoice);
  }

  async createInvoice(dto: CreateInvoiceDto, authorization?: string) {
    const session = await this.requireFinance(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);
    const normalized = await this.normalizeInvoiceDraft(dto);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const requestedInvoiceNumber = dto.invoiceNumber?.trim().toUpperCase() || undefined;
      const invoiceNumber =
        requestedInvoiceNumber ??
        (await this.generateInvoiceNumber(tx, dto.organizationId));

      // A manually supplied invoice number can reserve a future automatic
      // `INV-` number. Advance the sequence in the same transaction so the
      // generated series never catches up and collides with that invoice.
      if (requestedInvoiceNumber) {
        await this.reserveInvoiceNumber(tx, dto.organizationId, requestedInvoiceNumber);
      }

      const created = await tx.invoice.create({
        data: {
          id: dto.id,
          organizationId: dto.organizationId,
          customerId: dto.customerId,
          appointmentId: dto.appointmentId,
          invoiceNumber,
          status: "Draft",
          dueAt: dto.dueAtIso ? new Date(dto.dueAtIso) : undefined,
          notes: dto.notes,
          subtotal: normalized.totals.subtotal,
          discountAmount: normalized.totals.discountAmount,
          taxAmount: normalized.totals.taxAmount,
          totalAmount: normalized.totals.totalAmount,
          balanceAmount: normalized.totals.totalAmount,
          lineItems: {
            create: normalized.lineItems.map((item) => ({
              serviceId: item.serviceId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountAmount: item.discountAmount,
              taxAmount: item.taxAmount,
              lineTotal: item.lineTotal,
              sortOrder: item.sortOrder,
            })),
          },
        },
        include: {
          lineItems: { orderBy: [{ sortOrder: "asc" }] },
          payments: true,
          corrections: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "invoice",
          entityId: created.id,
          action: "created",
          newValue: {
            customerId: dto.customerId,
            appointmentId: dto.appointmentId ?? null,
            invoiceNumber,
            status: "Draft",
            lineItems: normalized.lineItems.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              lineTotal: item.lineTotal.toNumber(),
            })),
          },
          description: "Invoice created",
        },
      });

      return created;
    });

    return this.mapInvoice(invoice);
  }

  async updateInvoice(id: string, dto: UpdateInvoiceDto, authorization?: string) {
    const session = await this.requireFinance(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);

    const existing = await this.prisma.invoice.findFirst({
      where: { id, organizationId: dto.organizationId },
      include: {
        payments: true,
      },
    });

    if (!existing) {
      throw new NotFoundException("Invoice not found");
    }

    if (existing.status !== "Draft") {
      throw new BadRequestException(
        "Issued invoices cannot be edited; use a correction or void workflow",
      );
    }
    if (dto.status && dto.status !== "Draft") {
      throw new BadRequestException("Issue an invoice through the dedicated issue command");
    }

    const normalized = await this.normalizeInvoiceDraft(dto);
    const paidAmount = this.sumCompletedPayments(existing.payments);
    if (paidAmount.greaterThan(normalized.totals.totalAmount)) {
      throw new BadRequestException(
        "Invoice total cannot be lower than payments already collected",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });

      const nextStatus = this.deriveInvoiceStatus(
        dto.status ?? existing.status,
        normalized.totals.totalAmount,
        paidAmount,
      );
      const balanceAmount = normalized.totals.totalAmount.minus(paidAmount);

      const invoice = await tx.invoice.update({
        where: { id },
        data: {
          customerId: dto.customerId,
          appointmentId: dto.appointmentId,
          dueAt: dto.dueAtIso ? new Date(dto.dueAtIso) : null,
          notes: dto.notes ?? null,
          status: nextStatus,
          subtotal: normalized.totals.subtotal,
          discountAmount: normalized.totals.discountAmount,
          taxAmount: normalized.totals.taxAmount,
          totalAmount: normalized.totals.totalAmount,
          balanceAmount,
          lineItems: {
            create: normalized.lineItems.map((item) => ({
              serviceId: item.serviceId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountAmount: item.discountAmount,
              taxAmount: item.taxAmount,
              lineTotal: item.lineTotal,
              sortOrder: item.sortOrder,
            })),
          },
        },
        include: {
          lineItems: { orderBy: [{ sortOrder: "asc" }] },
          payments: { orderBy: [{ paidAt: "desc" }] },
          corrections: { orderBy: [{ executedAt: "desc" }] },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "invoice",
          entityId: id,
          action: "updated",
          newValue: {
            customerId: dto.customerId,
            appointmentId: dto.appointmentId ?? null,
            status: nextStatus,
            totalAmount: normalized.totals.totalAmount.toNumber(),
            balanceAmount: balanceAmount.toNumber(),
          },
          description: "Invoice updated",
        },
      });

      return invoice;
    });

    return this.mapInvoice(updated);
  }

  async issueInvoice(id: string, organizationId: string, authorization?: string) {
    const session = await this.requireFinanceAuthority(authorization);
    this.assertSameOrganization(session.organizationId, organizationId);

    const invoice = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "Invoice" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`,
      );
      const existing = await tx.invoice.findFirst({
        where: { id, organizationId },
        include: { lineItems: true, payments: true },
      });
      if (!existing) throw new NotFoundException("Invoice not found");
      if (existing.status !== "Draft") throw new BadRequestException("Only a draft invoice can be issued");
      if (!existing.lineItems.length) throw new BadRequestException("Invoice requires line items before issue");
      const issued = await tx.invoice.update({
        where: { id },
        data: { status: "Issued", issuedAt: new Date(), balanceAmount: existing.totalAmount },
        include: {
          lineItems: { orderBy: [{ sortOrder: "asc" }] },
          payments: { orderBy: [{ paidAt: "desc" }] },
          corrections: { orderBy: [{ executedAt: "desc" }] },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: session.id,
          entityType: "invoice",
          entityId: id,
          action: "issued",
          oldValue: { status: "Draft" },
          newValue: { status: "Issued", totalAmount: issued.totalAmount.toNumber() },
          description: "Invoice issued; financial snapshot is now immutable",
        },
      });
      return issued;
    });
    return this.mapInvoice(invoice);
  }

  async voidInvoice(id: string, organizationId: string, reason: string, authorization?: string) {
    const session = await this.requireFinanceAuthority(authorization);
    this.assertSameOrganization(session.organizationId, organizationId);
    if (!reason.trim()) throw new BadRequestException("Void reason is required");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Invoice" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`);
      const existing = await tx.invoice.findFirst({ where: { id, organizationId }, include: { payments: true } });
      if (!existing) throw new NotFoundException("Invoice not found");
      if (existing.status !== "Issued") throw new BadRequestException("Only an issued unpaid invoice can be voided");
      if (existing.payments.length) throw new BadRequestException("Invoices with payment history require a correction, not a void");
      const invoice = await tx.invoice.update({
        where: { id }, data: { status: "Void", balanceAmount: new Prisma.Decimal(0), notes: existing.notes ? `${existing.notes}\nVoid reason: ${reason.trim()}` : `Void reason: ${reason.trim()}` },
        include: {
          lineItems: { orderBy: [{ sortOrder: "asc" }] },
          payments: { orderBy: [{ paidAt: "desc" }] },
          corrections: { orderBy: [{ executedAt: "desc" }] },
        },
      });
      await tx.financialCorrection.create({ data: { organizationId, invoiceId: id, kind: "InvoiceVoid", status: "Executed", amount: new Prisma.Decimal(0), reason: reason.trim(), initiatedByUserId: session.id, executedAt: new Date() } });
      await tx.auditLog.create({ data: { organizationId, actorId: session.id, entityType: "invoice", entityId: id, action: "voided", oldValue: { status: "Issued" }, newValue: { status: "Void", reason: reason.trim() }, description: "Issued unpaid invoice voided" } });
      return this.mapInvoice(invoice);
    });
  }

  async deleteInvoice(id: string, authorization?: string) {
    const session = await this.requireFinanceAuthority(authorization);
    const existing = await this.prisma.invoice.findFirst({
      where: { id, organizationId: session.organizationId },
      include: {
        payments: true,
      },
    });

    if (!existing) {
      throw new NotFoundException("Invoice not found");
    }

    if (existing.status !== "Draft") {
      throw new BadRequestException("Only draft invoices can be deleted");
    }

    if (existing.payments.length) {
      throw new BadRequestException("Invoices with payments cannot be deleted");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId: existing.organizationId,
          actorId: session.id,
          entityType: "invoice",
          entityId: id,
          action: "deleted",
          description: "Draft invoice deleted",
        },
      });

      await tx.invoice.delete({ where: { id } });
    });

    return { ok: true };
  }

  async recordPayment(invoiceId: string, dto: RecordPaymentDto, authorization?: string) {
    const session = await this.requireFinance(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);

    const amount = new Prisma.Decimal(dto.amount);
    if (dto.status && dto.status !== "Completed") {
      throw new BadRequestException(
        "Manual payment recording creates a completed receipt; provider payments use payment intents",
      );
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "Invoice" WHERE id = ${invoiceId} AND "organizationId" = ${dto.organizationId} FOR UPDATE`,
      );

      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId: dto.organizationId },
        include: { payments: true },
      });

      if (!invoice) {
        throw new NotFoundException("Invoice not found");
      }

      this.assertInvoiceCanAcceptPayment(invoice.status);

      if (amount.greaterThan(invoice.balanceAmount)) {
        throw new BadRequestException("Payment amount cannot exceed invoice balance");
      }

      const created = await tx.payment.create({
        data: {
          id: dto.id,
          organizationId: dto.organizationId,
          invoiceId,
          customerId: invoice.customerId,
          appointmentId: invoice.appointmentId,
          amount,
          method: dto.method,
          status: dto.status ?? "Completed",
          paidAt: dto.paidAtIso ? new Date(dto.paidAtIso) : new Date(),
          referenceNumber: dto.referenceNumber,
          notes: dto.notes,
        },
      });

      await this.recalculateInvoiceFinancials(tx, invoiceId, dto.status ?? "Completed");

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "payment",
          entityId: created.id,
          action: "created",
          newValue: {
            invoiceId,
            amount: dto.amount,
            method: dto.method,
            status: dto.status ?? "Completed",
          },
          description: "Payment recorded",
        },
      });

      return created;
    });

    return this.mapPayment(payment);
  }

  async updatePayment(
    invoiceId: string,
    paymentId: string,
    dto: RecordPaymentDto,
    authorization?: string,
  ) {
    const session = await this.requireFinance(authorization);
    this.assertSameOrganization(session.organizationId, dto.organizationId);

    const [invoice, existing] = await Promise.all([
      this.prisma.invoice.findFirst({
        where: { id: invoiceId, organizationId: dto.organizationId },
        select: { id: true, organizationId: true },
      }),
      this.prisma.payment.findFirst({
        where: { id: paymentId, invoiceId, organizationId: dto.organizationId },
      }),
    ]);

    if (!invoice || !existing) {
      throw new NotFoundException("Payment or invoice not found");
    }

    if (existing.status === "Completed") {
      throw new BadRequestException(
        "Completed payments cannot be edited; record a refund or reversal instead",
      );
    }

    const peers = await this.prisma.payment.findMany({
      where: {
        invoiceId,
        organizationId: dto.organizationId,
        id: { not: paymentId },
      },
      select: { amount: true, status: true },
    });

    const completedPeerTotal = peers.reduce((sum, payment) => {
      return payment.status === "Completed" ? sum.plus(payment.amount) : sum;
    }, new Prisma.Decimal(0));
    const nextAmount = new Prisma.Decimal(dto.amount);
    const invoiceSnapshot = await this.prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId, organizationId: dto.organizationId },
      select: { totalAmount: true },
    });

    if (
      (dto.status ?? existing.status) === "Completed" &&
      completedPeerTotal.plus(nextAmount).greaterThan(invoiceSnapshot.totalAmount)
    ) {
      throw new BadRequestException("Updated payment exceeds invoice total");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          amount: nextAmount,
          method: dto.method,
          status: dto.status ?? existing.status,
          paidAt: dto.paidAtIso ? new Date(dto.paidAtIso) : existing.paidAt,
          referenceNumber: dto.referenceNumber ?? null,
          notes: dto.notes ?? null,
        },
      });

      await this.recalculateInvoiceFinancials(tx, invoiceId, dto.status ?? existing.status);

      await tx.auditLog.create({
        data: {
          organizationId: dto.organizationId,
          actorId: session.id,
          entityType: "payment",
          entityId: payment.id,
          action: "updated",
          newValue: {
            amount: dto.amount,
            method: dto.method,
            status: dto.status ?? existing.status,
          },
          description: "Payment updated",
        },
      });

      return payment;
    });

    return this.mapPayment(updated);
  }

  async createFinancialCorrection(
    invoiceId: string,
    paymentId: string,
    dto: CreateFinancialCorrectionDto,
    authorization?: string,
  ) {
    void invoiceId;
    void paymentId;
    void dto;
    await this.requireFinanceAuthority(authorization);
    throw new BadRequestException(
      "Legacy financial correction is disabled; use the governed v1 correction workflow",
    );
  }

  async deletePayment(invoiceId: string, paymentId: string, authorization?: string) {
    const session = await this.requireFinance(authorization);
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        invoiceId,
        organizationId: session.organizationId,
      },
    });

    if (!payment) {
      throw new NotFoundException("Payment not found");
    }

    if (payment.status === "Completed") {
      throw new BadRequestException(
        "Completed payments cannot be deleted; record a refund or reversal instead",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId: payment.organizationId,
          actorId: session.id,
          entityType: "payment",
          entityId: payment.id,
          action: "deleted",
          description: "Payment deleted",
        },
      });

      await tx.payment.delete({ where: { id: payment.id } });
      await this.recalculateInvoiceFinancials(tx, invoiceId);
    });

    return { ok: true };
  }

  private async requireFinance(authorization?: string) {
    const session = await this.auth.requireSession(authorization);
    assertFinanceOperator(session);
    return session;
  }

  private async requireFinanceAuthority(authorization?: string) {
    const session = await this.requireFinance(authorization);
    if (!effectiveRoleUnion(session).some((role) => ["Owner", "Admin", "Manager", "Finance"].includes(role))) {
      throw new ForbiddenException(
        "Receptionists may record eligible payments but cannot issue, delete, or correct invoices",
      );
    }
    return session;
  }

  private financeLocationWhere(session: {
    effectiveRoleScopes?: Array<{ role: string; locationId: string | null }>;
  }) {
    if (!session.effectiveRoleScopes) return undefined;
    if (
      session.effectiveRoleScopes.some(
        (scope) => scope.locationId === null && financeRoles.has(scope.role),
      )
    ) {
      return undefined;
    }
    return {
      in: [
        ...new Set(
          session.effectiveRoleScopes
            .filter(
              (scope) =>
                scope.locationId !== null && financeRoles.has(scope.role),
            )
            .map((scope) => scope.locationId!),
        ),
      ],
    };
  }

  private assertInvoiceCanAcceptPayment(status: InvoiceStatus) {
    if (status === "Draft") {
      throw new BadRequestException("Issue the invoice before recording payment");
    }

    if (status === "Paid" || status === "Cancelled" || status === "Void") {
      throw new BadRequestException("Payments can only be recorded on issued invoices with a remaining balance");
    }
  }

  private assertSameOrganization(sessionOrganizationId: string, targetOrganizationId: string) {
    if (sessionOrganizationId !== targetOrganizationId) {
      throw new BadRequestException("Cross-organization billing access is not allowed");
    }
  }

  private async normalizeInvoiceDraft(dto: CreateInvoiceDto | UpdateInvoiceDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId: dto.organizationId },
      select: { id: true },
    });

    if (!customer) {
      throw new BadRequestException("Invoice customer is invalid");
    }

    let appointmentServices:
      | Array<{
          id: string;
          name: string;
          price: Prisma.Decimal | null;
        }>
      | undefined;

    if (dto.appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          id: dto.appointmentId,
          organizationId: dto.organizationId,
          customerId: dto.customerId,
        },
        include: {
          services: {
            include: {
              service: {
                select: { id: true, name: true, price: true },
              },
            },
          },
        },
      });

      if (!appointment) {
        throw new BadRequestException(
          "Invoice appointment is invalid or does not belong to this patient",
        );
      }

      appointmentServices = appointment.services.map((item) => item.service);
    }

    const lineItems =
      dto.lineItems.length > 0
        ? await this.normalizeProvidedLineItems(dto.organizationId, dto.lineItems)
        : this.normalizeAppointmentLineItems(appointmentServices);

    if (!lineItems.length) {
      throw new BadRequestException("Invoice requires at least one line item");
    }

    const totals = lineItems.reduce(
      (acc, item) => ({
        subtotal: acc.subtotal.plus(item.unitPrice.times(item.quantity)),
        discountAmount: acc.discountAmount.plus(item.discountAmount),
        taxAmount: acc.taxAmount.plus(item.taxAmount),
        totalAmount: acc.totalAmount.plus(item.lineTotal),
      }),
      {
        subtotal: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
      },
    );

    return {
      lineItems,
      totals,
      status: dto.status ?? "Draft",
    };
  }

  private async normalizeProvidedLineItems(
    organizationId: string,
    lineItems: InvoiceLineItemDto[],
  ) {
    const serviceIds = lineItems
      .map((item) => item.serviceId)
      .filter((serviceId): serviceId is string => Boolean(serviceId));

    const services = serviceIds.length
      ? await this.prisma.service.findMany({
          where: {
            id: { in: serviceIds },
            organizationId,
          },
          select: { id: true },
        })
      : [];

    if (services.length !== new Set(serviceIds).size) {
      throw new BadRequestException("One or more invoice services are invalid");
    }

    return lineItems.map((item, index) => {
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      const discountAmount = new Prisma.Decimal(item.discountAmount ?? 0);
      const taxAmount = new Prisma.Decimal(item.taxAmount ?? 0);
      const gross = unitPrice.times(item.quantity);
      const lineTotal = gross.minus(discountAmount).plus(taxAmount);
      if (lineTotal.lessThan(0)) {
        throw new BadRequestException("Invoice line total cannot be negative");
      }

      return {
        serviceId: item.serviceId,
        description: item.description,
        quantity: item.quantity,
        unitPrice,
        discountAmount,
        taxAmount,
        lineTotal,
        sortOrder: item.sortOrder ?? index,
      };
    });
  }

  private normalizeAppointmentLineItems(
    services:
      | Array<{
          id: string;
          name: string;
          price: Prisma.Decimal | null;
        }>
      | undefined,
  ) {
    if (!services?.length) {
      return [];
    }

    return services.map((service, index) => ({
      serviceId: service.id,
      description: service.name,
      quantity: 1,
      unitPrice: service.price ?? new Prisma.Decimal(0),
      discountAmount: new Prisma.Decimal(0),
      taxAmount: new Prisma.Decimal(0),
      lineTotal: service.price ?? new Prisma.Decimal(0),
      sortOrder: index,
    }));
  }

  private async generateInvoiceNumber(tx: Prisma.TransactionClient, organizationId: string) {
    const sequence = await tx.invoiceNumberSequence.upsert({
      where: { organizationId }, create: { organizationId, nextValue: 2 }, update: { nextValue: { increment: 1 } },
    });
    return `INV-${String(sequence.nextValue - 1).padStart(5, "0")}`;
  }

  private async reserveInvoiceNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
    invoiceNumber: string,
  ) {
    const match = /^INV-(\d+)$/.exec(invoiceNumber);
    if (!match) return;

    const numericValue = Number(match[1]);
    if (!Number.isSafeInteger(numericValue) || numericValue >= 2_147_483_647) {
      throw new BadRequestException("Invoice number is outside the supported sequence range");
    }

    const nextValue = numericValue + 1;
    await tx.$executeRaw(
      Prisma.sql`
        INSERT INTO "InvoiceNumberSequence" ("organizationId", "nextValue", "createdAt", "updatedAt")
        VALUES (${organizationId}, ${nextValue}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("organizationId") DO UPDATE
        SET "nextValue" = GREATEST("InvoiceNumberSequence"."nextValue", EXCLUDED."nextValue"),
            "updatedAt" = CURRENT_TIMESTAMP
      `,
    );
  }

  private sumCompletedPayments(payments: Array<{ amount: Prisma.Decimal; status: PaymentStatus }>) {
    return payments.reduce((sum, payment) => {
      return payment.status === "Completed" ? sum.plus(payment.amount) : sum;
    }, new Prisma.Decimal(0));
  }

  private deriveInvoiceStatus(
    requestedStatus: InvoiceStatus,
    totalAmount: Prisma.Decimal,
    paidAmount: Prisma.Decimal,
  ): InvoiceStatus {
    if (requestedStatus === "Cancelled" || requestedStatus === "Void") {
      return requestedStatus;
    }

    if (paidAmount.greaterThanOrEqualTo(totalAmount) && totalAmount.greaterThan(0)) {
      return "Paid";
    }

    if (paidAmount.greaterThan(0)) {
      return "PartiallyPaid";
    }

    return requestedStatus === "Draft" ? "Draft" : "Issued";
  }

  private async recalculateInvoiceFinancials(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    preferredStatus?: InvoiceStatus | PaymentStatus,
  ) {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { payments: true, corrections: true },
    });
    const paidAmount = this.sumCompletedPayments(invoice.payments).minus(
      invoice.corrections
        .filter((correction) => correction.status === "Executed")
        .reduce((sum, correction) => sum.plus(correction.amount), new Prisma.Decimal(0)),
    );
    const status = this.deriveInvoiceStatus(
      invoice.status,
      invoice.totalAmount,
      paidAmount,
    );

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        balanceAmount: invoice.totalAmount.minus(paidAmount),
        status:
          preferredStatus === "Cancelled" || preferredStatus === "Void"
            ? preferredStatus
            : status,
      },
    });
  }

  private mapInvoice(
    invoice: Invoice & {
      lineItems: Array<{
        id: string;
        serviceId: string | null;
        description: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
        discountAmount: Prisma.Decimal;
        taxAmount: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
        sortOrder: number;
      }>;
      payments: Payment[];
      corrections: FinancialCorrection[];
    },
  ) {
    return {
      id: invoice.id,
      organizationId: invoice.organizationId,
      customerId: invoice.customerId,
      appointmentId: invoice.appointmentId ?? undefined,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issuedAtIso: invoice.issuedAt.toISOString(),
      dueAtIso: invoice.dueAt?.toISOString(),
      subtotal: invoice.subtotal.toNumber(),
      discountAmount: invoice.discountAmount.toNumber(),
      taxAmount: invoice.taxAmount.toNumber(),
      totalAmount: invoice.totalAmount.toNumber(),
      balanceAmount: invoice.balanceAmount.toNumber(),
      notes: invoice.notes ?? undefined,
      lineItems: invoice.lineItems.map((item) => ({
        id: item.id,
        serviceId: item.serviceId ?? undefined,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toNumber(),
        discountAmount: item.discountAmount.toNumber(),
        taxAmount: item.taxAmount.toNumber(),
        lineTotal: item.lineTotal.toNumber(),
        sortOrder: item.sortOrder,
      })),
      payments: invoice.payments.map((payment) => this.mapPayment(payment)),
      corrections: invoice.corrections.map((correction) => ({
        id: correction.id,
        organizationId: correction.organizationId,
        invoiceId: correction.invoiceId,
        paymentId: correction.paymentId ?? undefined,
        kind: correction.kind as "Refund" | "Reversal",
        amount: correction.amount.toNumber(),
        reason: correction.reason,
        initiatedByUserId: correction.initiatedByUserId,
        executedAtIso: correction.executedAt?.toISOString(),
        providerReference: correction.providerReference ?? undefined,
        createdAtIso: correction.createdAt.toISOString(),
      })),
      createdAtIso: invoice.createdAt.toISOString(),
      updatedAtIso: invoice.updatedAt.toISOString(),
    };
  }

  private mapPayment(payment: Payment) {
    return {
      id: payment.id,
      organizationId: payment.organizationId,
      invoiceId: payment.invoiceId,
      customerId: payment.customerId,
      appointmentId: payment.appointmentId ?? undefined,
      amount: payment.amount.toNumber(),
      method: payment.method as PaymentMethod,
      status: payment.status as PaymentStatus,
      referenceNumber: payment.referenceNumber ?? undefined,
      paidAtIso: payment.paidAt.toISOString(),
      notes: payment.notes ?? undefined,
      createdAtIso: payment.createdAt.toISOString(),
      updatedAtIso: payment.updatedAt.toISOString(),
    };
  }
}
