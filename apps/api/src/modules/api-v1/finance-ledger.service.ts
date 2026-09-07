import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  FinancialCorrectionKind,
  FinancialCorrectionStatus,
  InvoiceStatus,
  PaymentMethod,
  Prisma,
  type UserRole,
} from "@prisma/client";

import {
  AuthService,
  type AuthSession,
  type AuthSessionReference,
} from "../auth/auth.service";
import { effectiveRoleUnion, effectiveRoleUnionForLocation } from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import type {
  ApproveFinanceCorrectionDto,
  CreateFinanceInvoiceDto,
  CreateFinanceCorrectionDto,
  FinanceCorrectionQueryDto,
  FinanceReconciliationQueryDto,
  FinanceWorkspaceQueryDto,
  RecordFinancePaymentDto,
  RejectFinanceCorrectionDto,
} from "./dto/finance-ledger.dto";

const DRAFT_ROLES = new Set(["Owner", "Admin", "Finance", "Receptionist"]);
const ISSUE_ROLES = new Set(["Owner", "Admin", "Finance"]);
const PAYMENT_ROLES = DRAFT_ROLES;
const CORRECTION_ROLES = ISSUE_ROLES;
const APPROVAL_ROLES = new Set(["Owner", "Admin"]);
const RECONCILIATION_ROLES = ISSUE_ROLES;
const RECONCILIATION_ISSUED_STATUSES: InvoiceStatus[] = [
  "Issued",
  "PartiallyPaid",
  "Paid",
  "Void",
];
const RECONCILIATION_OUTSTANDING_STATUSES: InvoiceStatus[] = [
  "Issued",
  "PartiallyPaid",
];
const NON_CASH_METHODS = new Set<PaymentMethod>([
  "Card",
  "BankTransfer",
  "MobileWallet",
  "Insurance",
]);
const ZERO = new Prisma.Decimal(0);

type FinanceScope = {
  roles: string[];
  locationWhere?: { equals?: string; in?: string[] };
};

@Injectable()
export class FinanceLedgerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async createInvoice(
    dto: CreateFinanceInvoiceDto,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireAnyRole(actor, dto.locationId, DRAFT_ROLES);
    await this.assertLocation(actor.organizationId, dto.locationId);
    const normalized = await this.normalizeInvoiceLines(actor.organizationId, dto);
    const requestHash = this.hash({
      locationId: dto.locationId,
      clientId: dto.clientId,
      appointmentId: dto.appointmentId ?? null,
      dueAtIso: dto.dueAtIso ?? null,
      notes: dto.notes?.trim() || null,
      lineItems: normalized.map((item) => ({
        serviceId: item.serviceId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPriceNpr: this.money(item.unitPrice),
        discountNpr: this.money(item.discount),
        taxNpr: this.money(item.tax),
      })),
    });
    const replay = await this.prisma.invoice.findUnique({
      where: {
        organizationId_createdByUserId_idempotencyKey: {
          organizationId: actor.organizationId,
          createdByUserId: actor.id,
          idempotencyKey,
        },
      },
    });
    if (replay) {
      this.assertReplay(replay.requestHash, requestHash);
      return { invoice: this.mapInvoiceCommand(replay), replayed: true };
    }
    const invoice = await this.serializable(async (tx) => {
      await this.lockIdempotency(
        tx,
        `finance:invoice-create:${actor.organizationId}:${actor.id}:${idempotencyKey}`,
      );
      const insideReplay = await tx.invoice.findUnique({
        where: {
          organizationId_createdByUserId_idempotencyKey: {
            organizationId: actor.organizationId,
            createdByUserId: actor.id,
            idempotencyKey,
          },
        },
      });
      if (insideReplay) {
        this.assertReplay(insideReplay.requestHash, requestHash);
        return insideReplay;
      }
      const client = await tx.customer.findFirst({
        where: {
          id: dto.clientId,
          organizationId: actor.organizationId,
          archivedAt: null,
          mergedIntoCustomerId: null,
        },
        select: { id: true },
      });
      if (!client) {
        throw this.conflict(
          "CLIENT_UNAVAILABLE",
          "The selected Client is unavailable.",
        );
      }
      if (dto.appointmentId) {
        const appointment = await tx.appointment.findFirst({
          where: {
            id: dto.appointmentId,
            organizationId: actor.organizationId,
            customerId: dto.clientId,
            locationId: dto.locationId,
          },
          select: { id: true },
        });
        if (!appointment) {
          throw this.conflict(
            "APPOINTMENT_UNAVAILABLE",
            "The selected appointment is unavailable for this invoice.",
          );
        }
      }
      const sequence = await tx.invoiceNumberSequence.upsert({
        where: { organizationId: actor.organizationId },
        create: { organizationId: actor.organizationId, nextValue: 2 },
        update: { nextValue: { increment: 1 } },
      });
      const invoiceNumber = `INV-${String(sequence.nextValue - 1).padStart(5, "0")}`;
      const subtotal = normalized.reduce(
        (sum, item) => sum.plus(item.unitPrice.times(item.quantity)),
        ZERO,
      );
      const discount = normalized.reduce(
        (sum, item) => sum.plus(item.discount),
        ZERO,
      );
      const tax = normalized.reduce((sum, item) => sum.plus(item.tax), ZERO);
      const total = subtotal.minus(discount).plus(tax);
      const created = await tx.invoice.create({
        data: {
          organizationId: actor.organizationId,
          locationId: dto.locationId,
          customerId: dto.clientId,
          appointmentId: dto.appointmentId || null,
          invoiceNumber,
          status: "Draft",
          currency: "NPR",
          dueAt: dto.dueAtIso ? new Date(dto.dueAtIso) : null,
          notes: dto.notes?.trim() || null,
          subtotal,
          discountAmount: discount,
          taxAmount: tax,
          totalAmount: total,
          balanceAmount: total,
          createdByUserId: actor.id,
          idempotencyKey,
          requestHash,
          lineItems: {
            create: normalized.map((item, index) => ({
              serviceId: item.serviceId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountAmount: item.discount,
              taxAmount: item.tax,
              lineTotal: item.unitPrice
                .times(item.quantity)
                .minus(item.discount)
                .plus(item.tax),
              sortOrder: index,
            })),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "invoice",
          entityId: created.id,
          action: "created",
          newValue: {
            invoiceNumber,
            locationId: dto.locationId,
            clientId: dto.clientId,
            totalNpr: this.money(total),
            lineItemCount: normalized.length,
          },
          description: "Finance v1 draft invoice created",
        },
      });
      return created;
    });
    return { invoice: this.mapInvoiceCommand(invoice), replayed: false };
  }

  async issueInvoice(
    id: string,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    const scope = this.financeScope(actor, undefined, ISSUE_ROLES);
    const initial = await this.prisma.invoice.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        ...(scope.locationWhere ? { locationId: scope.locationWhere } : {}),
      },
    });
    if (!initial) throw new NotFoundException("Invoice not found");
    const requestHash = this.hash({ invoiceId: id, command: "issue" });
    if (
      initial.issuedByUserId === actor.id &&
      initial.issueIdempotencyKey === idempotencyKey
    ) {
      this.assertReplay(initial.issueRequestHash, requestHash);
      return { invoice: this.mapInvoiceCommand(initial), replayed: true };
    }
    const invoice = await this.serializable(async (tx) => {
      await this.lockInvoice(tx, actor.organizationId, id);
      const current = await tx.invoice.findFirst({
        where: { id, organizationId: actor.organizationId },
        include: { lineItems: true },
      });
      if (!current) throw new NotFoundException("Invoice not found");
      this.requireAnyRole(actor, current.locationId, ISSUE_ROLES);
      if (
        current.issuedByUserId === actor.id &&
        current.issueIdempotencyKey === idempotencyKey
      ) {
        this.assertReplay(current.issueRequestHash, requestHash);
        return current;
      }
      if (current.status !== "Draft") {
        throw this.conflict(
          "INVOICE_NOT_DRAFT",
          "Only a draft invoice can be issued.",
        );
      }
      if (!current.lineItems.length || !current.totalAmount.isPositive()) {
        throw this.conflict(
          "INVOICE_NOT_ISSUABLE",
          "Invoice requires a positive total and at least one line item.",
        );
      }
      const issuedAt = new Date();
      const issued = await tx.invoice.update({
        where: { id },
        data: {
          status: "Issued",
          issuedAt,
          balanceAmount: current.totalAmount,
          issuedByUserId: actor.id,
          issueIdempotencyKey: idempotencyKey,
          issueRequestHash: requestHash,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "invoice",
          entityId: id,
          action: "issued",
          oldValue: { status: "Draft" },
          newValue: {
            status: "Issued",
            totalNpr: this.money(current.totalAmount),
          },
          description: "Invoice issued through finance v1",
        },
      });
      return issued;
    });
    return { invoice: this.mapInvoiceCommand(invoice), replayed: false };
  }

  async workspace(
    query: FinanceWorkspaceQueryDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    const scope = this.financeScope(actor, query.locationId, DRAFT_ROLES);
    if (query.locationId) {
      await this.assertLocation(actor.organizationId, query.locationId);
    }
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(scope.locationWhere ? { locationId: scope.locationWhere } : {}),
        ...(query.clientId ? { customerId: query.clientId } : {}),
      },
      include: {
        customer: { select: { id: true, fullName: true, patientCode: true } },
        payments: { orderBy: [{ paidAt: "desc" }] },
        corrections: { orderBy: [{ requestedAt: "desc" }] },
      },
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    const summary = this.summary(invoices);
    return {
      capabilities: this.capabilities(scope.roles),
      createLocationIds: this.allowedLocationIds(actor, DRAFT_ROLES),
      summary,
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        client: {
          id: invoice.customer.id,
          name: invoice.customer.fullName,
          clientCode: invoice.customer.patientCode,
        },
        locationId: invoice.locationId,
        status: invoice.status,
        issuedAtIso: invoice.issuedAt.toISOString(),
        dueAtIso: invoice.dueAt?.toISOString() ?? null,
        totalNpr: this.money(invoice.totalAmount),
        balanceNpr: this.money(invoice.balanceAmount),
        collectedNpr: this.money(
          invoice.payments
            .filter((item) => item.status === "Completed")
            .reduce((sum, item) => sum.plus(item.amount), ZERO),
        ),
        correctedNpr: this.money(
          invoice.corrections
            .filter((item) => item.status === "Executed")
            .reduce((sum, item) => sum.plus(item.amount), ZERO),
        ),
        paymentCount: invoice.payments.length,
        pendingCorrectionCount: invoice.corrections.filter(
          (item) => item.status === "PendingApproval",
        ).length,
        capabilities: this.capabilities(
          this.rolesAt(actor, invoice.locationId),
        ),
      })),
    };
  }

  async invoiceDetail(id: string, authorization?: AuthSessionReference) {
    const actor = await this.auth.requireSession(authorization);
    const scope = this.financeScope(actor, undefined, DRAFT_ROLES);
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        ...(scope.locationWhere ? { locationId: scope.locationWhere } : {}),
      },
      include: {
        customer: { select: { id: true, fullName: true, patientCode: true } },
        lineItems: { orderBy: [{ sortOrder: "asc" }] },
        payments: {
          include: { corrections: true },
          orderBy: [{ paidAt: "asc" }, { id: "asc" }],
        },
        corrections: {
          include: {
            initiatedBy: { select: { id: true, name: true } },
            approvedBy: { select: { id: true, name: true } },
            rejectedBy: { select: { id: true, name: true } },
          },
          orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    const ledger = [
      {
        id: `invoice:${invoice.id}`,
        type: "invoice_issued" as const,
        occurredAtIso: invoice.issuedAt.toISOString(),
        amountNpr: this.money(invoice.totalAmount),
        status: invoice.status,
      },
      ...invoice.payments.map((payment) => ({
        id: `payment:${payment.id}`,
        type: "payment" as const,
        occurredAtIso: payment.paidAt.toISOString(),
        amountNpr: this.money(payment.amount),
        status: payment.status,
        method: payment.method,
        reference: payment.referenceNumber ?? null,
        paymentId: payment.id,
        correctableNpr: this.money(
          payment.amount.minus(
            payment.corrections
              .filter((item) =>
                ["PendingApproval", "Executed"].includes(item.status),
              )
              .reduce((sum, item) => sum.plus(item.amount), ZERO),
          ),
        ),
      })),
      ...invoice.corrections.map((correction) => ({
        id: `correction:${correction.id}`,
        type: "correction" as const,
        occurredAtIso: correction.requestedAt.toISOString(),
        amountNpr: this.money(correction.amount),
        status: correction.status,
        kind: correction.kind,
        reason: correction.reason,
        correctionId: correction.id,
        version: correction.version,
        initiatedBy: correction.initiatedBy,
        approvedBy: correction.approvedBy,
        rejectedBy: correction.rejectedBy,
        executedAtIso: correction.executedAt?.toISOString() ?? null,
      })),
    ].sort((left, right) =>
      left.occurredAtIso.localeCompare(right.occurredAtIso),
    );
    const executed = invoice.corrections
      .filter((item) => item.status === "Executed")
      .reduce((sum, item) => sum.plus(item.amount), ZERO);
    const collected = invoice.payments
      .filter((item) => item.status === "Completed")
      .reduce((sum, item) => sum.plus(item.amount), ZERO);
    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        client: {
          id: invoice.customer.id,
          name: invoice.customer.fullName,
          clientCode: invoice.customer.patientCode,
        },
        locationId: invoice.locationId,
        status: invoice.status,
        capabilities: this.capabilities(
          this.rolesAt(actor, invoice.locationId),
        ),
        currency: invoice.currency,
        issuedAtIso: invoice.issuedAt.toISOString(),
        dueAtIso: invoice.dueAt?.toISOString() ?? null,
        subtotalNpr: this.money(invoice.subtotal),
        discountNpr: this.money(invoice.discountAmount),
        taxNpr: this.money(invoice.taxAmount),
        totalNpr: this.money(invoice.totalAmount),
        collectedNpr: this.money(collected),
        correctedNpr: this.money(executed),
        balanceNpr: this.money(invoice.balanceAmount),
        notes: invoice.notes,
        lineItems: invoice.lineItems.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity,
          unitPriceNpr: this.money(item.unitPrice),
          discountNpr: this.money(item.discountAmount),
          taxNpr: this.money(item.taxAmount),
          totalNpr: this.money(item.lineTotal),
        })),
      },
      ledger,
    };
  }

  async recordPayment(
    invoiceId: string,
    dto: RecordFinancePaymentDto,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireAnyRole(actor, dto.locationId, PAYMENT_ROLES);
    await this.assertLocation(actor.organizationId, dto.locationId);
    const amount = this.amount(dto.amountNpr);
    if (
      NON_CASH_METHODS.has(dto.method) &&
      !dto.referenceNumber?.trim()
    ) {
      throw new BadRequestException({
        code: "PAYMENT_REFERENCE_REQUIRED",
        message: "A reference is required for this payment method.",
      });
    }
    const requestHash = this.hash({
      invoiceId,
      locationId: dto.locationId,
      amountNpr: this.money(amount),
      method: dto.method,
      paidAtIso: dto.paidAtIso ?? null,
      referenceNumber: dto.referenceNumber?.trim() || null,
      notes: dto.notes?.trim() || null,
    });
    const replay = await this.findPaymentReplay(actor, idempotencyKey);
    if (replay) {
      this.assertReplay(replay.requestHash, requestHash);
      return { payment: this.mapPayment(replay), replayed: true };
    }
    const payment = await this.serializable(async (tx) => {
      await this.lockIdempotency(
        tx,
        `finance:payment:${actor.organizationId}:${actor.id}:${idempotencyKey}`,
      );
      const insideReplay = await tx.payment.findUnique({
        where: {
          organizationId_recordedByUserId_idempotencyKey: {
            organizationId: actor.organizationId,
            recordedByUserId: actor.id,
            idempotencyKey,
          },
        },
      });
      if (insideReplay) {
        this.assertReplay(insideReplay.requestHash, requestHash);
        return insideReplay;
      }
      await this.lockInvoice(tx, actor.organizationId, invoiceId);
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId: actor.organizationId },
      });
      if (!invoice) throw new NotFoundException("Invoice not found");
      if (invoice.locationId !== dto.locationId) {
        throw this.conflict(
          "FINANCE_LOCATION_MISMATCH",
          invoice.locationId
            ? "Invoice and payment locations do not match."
            : "Assign this legacy invoice to a clinic location before recording payment.",
        );
      }
      if (!["Issued", "PartiallyPaid"].includes(invoice.status)) {
        throw this.conflict(
          "INVOICE_NOT_PAYABLE",
          "This invoice cannot accept a payment.",
        );
      }
      if (amount.greaterThan(invoice.balanceAmount)) {
        throw this.conflict(
          "PAYMENT_EXCEEDS_BALANCE",
          "Payment amount exceeds the remaining balance.",
        );
      }
      const created = await tx.payment.create({
        data: {
          organizationId: actor.organizationId,
          invoiceId,
          customerId: invoice.customerId,
          appointmentId: invoice.appointmentId,
          locationId: dto.locationId,
          amount,
          currency: "NPR",
          method: dto.method,
          status: "Completed",
          paidAt: dto.paidAtIso ? new Date(dto.paidAtIso) : new Date(),
          referenceNumber: dto.referenceNumber?.trim() || null,
          notes: dto.notes?.trim() || null,
          recordedByUserId: actor.id,
          idempotencyKey,
          requestHash,
        },
      });
      await this.recalculateInvoice(tx, invoiceId);
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "payment",
          entityId: created.id,
          action: "recorded",
          newValue: {
            invoiceId,
            locationId: dto.locationId,
            amountNpr: this.money(amount),
            method: dto.method,
            referenceProvided: Boolean(dto.referenceNumber?.trim()),
          },
          description: "Completed payment recorded through finance v1",
        },
      });
      return created;
    });
    return { payment: this.mapPayment(payment), replayed: false };
  }

  async requestCorrection(
    invoiceId: string,
    paymentId: string,
    dto: CreateFinanceCorrectionDto,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    const scope = this.financeScope(actor, undefined, CORRECTION_ROLES);
    const initial = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        invoiceId,
        organizationId: actor.organizationId,
        ...(scope.locationWhere ? { locationId: scope.locationWhere } : {}),
      },
      select: { id: true, locationId: true },
    });
    if (!initial) throw new NotFoundException("Payment not found");
    const amount = this.amount(dto.amountNpr);
    const requestHash = this.hash({
      invoiceId,
      paymentId,
      kind: dto.kind,
      amountNpr: this.money(amount),
      reason: dto.reason.trim(),
      providerReference: dto.providerReference?.trim() || null,
    });
    const replay = await this.findCorrectionReplay(actor, idempotencyKey);
    if (replay) {
      this.assertReplay(replay.requestHash, requestHash);
      return { correction: this.mapCorrection(replay), replayed: true };
    }
    const correction = await this.serializable(async (tx) => {
      await this.lockIdempotency(
        tx,
        `finance:correction:${actor.organizationId}:${actor.id}:${idempotencyKey}`,
      );
      const insideReplay = await tx.financialCorrection.findUnique({
        where: {
          organizationId_initiatedByUserId_idempotencyKey: {
            organizationId: actor.organizationId,
            initiatedByUserId: actor.id,
            idempotencyKey,
          },
        },
      });
      if (insideReplay) {
        this.assertReplay(insideReplay.requestHash, requestHash);
        return insideReplay;
      }
      await this.lockInvoice(tx, actor.organizationId, invoiceId);
      await this.lockPayment(tx, actor.organizationId, paymentId);
      const payment = await tx.payment.findFirst({
        where: {
          id: paymentId,
          invoiceId,
          organizationId: actor.organizationId,
        },
        include: { corrections: true },
      });
      if (!payment) throw new NotFoundException("Payment not found");
      if (payment.status !== "Completed") {
        throw this.conflict(
          "PAYMENT_NOT_CORRECTABLE",
          "Only completed payments can be corrected.",
        );
      }
      if (
        dto.kind === "Refund" &&
        NON_CASH_METHODS.has(payment.method) &&
        !dto.providerReference?.trim()
      ) {
        throw new BadRequestException({
          code: "REFUND_REFERENCE_REQUIRED",
          message:
            "A completed external refund reference is required for this payment method.",
        });
      }
      const reserved = payment.corrections
        .filter((item) =>
          ["PendingApproval", "Executed"].includes(item.status),
        )
        .reduce((sum, item) => sum.plus(item.amount), ZERO);
      if (reserved.plus(amount).greaterThan(payment.amount)) {
        throw this.conflict(
          "CORRECTION_EXCEEDS_AVAILABLE",
          "Correction amount exceeds the remaining correctable amount.",
        );
      }
      const setting = await tx.organizationSetting.findUnique({
        where: { organizationId: actor.organizationId },
        select: { financeCorrectionApprovalThresholdNpr: true },
      });
      const threshold =
        setting?.financeCorrectionApprovalThresholdNpr ?? ZERO;
      const needsApproval = amount.greaterThanOrEqualTo(threshold);
      const now = new Date();
      const created = await tx.financialCorrection.create({
        data: {
          organizationId: actor.organizationId,
          locationId: payment.locationId,
          invoiceId,
          paymentId,
          kind: dto.kind,
          status: needsApproval ? "PendingApproval" : "Executed",
          amount,
          currency: "NPR",
          reason: dto.reason.trim(),
          initiatedByUserId: actor.id,
          executedAt: needsApproval ? null : now,
          idempotencyKey,
          requestHash,
          providerReference: dto.providerReference?.trim() || null,
        },
      });
      if (!needsApproval) await this.recalculateInvoice(tx, invoiceId);
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "financial_correction",
          entityId: created.id,
          action: needsApproval ? "requested" : "executed",
          newValue: {
            invoiceId,
            paymentId,
            kind: dto.kind,
            status: created.status,
            amountNpr: this.money(amount),
            reason: dto.reason.trim(),
          },
          description: needsApproval
            ? "Financial correction requested for distinct approval"
            : "Financial correction executed below approval threshold",
        },
      });
      return created;
    });
    return { correction: this.mapCorrection(correction), replayed: false };
  }

  async listCorrections(
    query: FinanceCorrectionQueryDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    const scope = this.financeScope(
      actor,
      query.locationId,
      CORRECTION_ROLES,
    );
    const rows = await this.prisma.financialCorrection.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(scope.locationWhere ? { locationId: scope.locationWhere } : {}),
      },
      include: {
        invoice: { select: { invoiceNumber: true } },
        payment: { select: { amount: true, method: true } },
        initiatedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    return {
      items: rows.map((row) => ({
        ...this.mapCorrection(row),
        invoiceNumber: row.invoice.invoiceNumber,
        paymentAmountNpr: row.payment
          ? this.money(row.payment.amount)
          : null,
        paymentMethod: row.payment?.method ?? null,
        initiatedBy: row.initiatedBy,
        canApprove:
          row.status === "PendingApproval" &&
          row.initiatedByUserId !== actor.id &&
          this.hasAnyRoleAt(actor, row.locationId, APPROVAL_ROLES),
      })),
    };
  }

  async approveCorrection(
    id: string,
    dto: ApproveFinanceCorrectionDto,
    authorization?: AuthSessionReference,
  ) {
    return this.decideCorrection(id, dto.expectedVersion, "approve", null, authorization);
  }

  async rejectCorrection(
    id: string,
    dto: RejectFinanceCorrectionDto,
    authorization?: AuthSessionReference,
  ) {
    return this.decideCorrection(
      id,
      dto.expectedVersion,
      "reject",
      dto.reason.trim(),
      authorization,
    );
  }

  async reconciliation(
    query: FinanceReconciliationQueryDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    const scope = this.financeScope(
      actor,
      query.locationId,
      RECONCILIATION_ROLES,
    );
    const startsAt = new Date(`${query.date}T00:00:00+05:45`);
    const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60_000);
    const invoiceScope = {
      organizationId: actor.organizationId,
      ...(scope.locationWhere ? { locationId: scope.locationWhere } : {}),
    } satisfies Prisma.InvoiceWhereInput;
    const [issuedSummary, outstandingSummary, paymentRows, correctionRows] =
      await Promise.all([
        this.prisma.invoice.aggregate({
          where: {
            ...invoiceScope,
            status: { in: RECONCILIATION_ISSUED_STATUSES },
            issuedAt: { gte: startsAt, lt: endsAt },
          },
          _sum: { totalAmount: true },
        }),
        this.prisma.invoice.aggregate({
          where: {
            ...invoiceScope,
            status: { in: RECONCILIATION_OUTSTANDING_STATUSES },
          },
          _sum: { balanceAmount: true },
        }),
        this.prisma.payment.findMany({
          where: {
            organizationId: actor.organizationId,
            ...(scope.locationWhere
              ? { locationId: scope.locationWhere }
              : {}),
            paidAt: { gte: startsAt, lt: endsAt },
          },
          include: { invoice: { select: { invoiceNumber: true } } },
          orderBy: [{ paidAt: "asc" }, { id: "asc" }],
        }),
        this.prisma.financialCorrection.findMany({
          where: {
            organizationId: actor.organizationId,
            ...(scope.locationWhere
              ? { locationId: scope.locationWhere }
              : {}),
            OR: [
              { requestedAt: { gte: startsAt, lt: endsAt } },
              { executedAt: { gte: startsAt, lt: endsAt } },
            ],
          },
          include: { invoice: { select: { invoiceNumber: true } } },
          orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
        }),
      ]);
    const payments = paymentRows.map((payment) => ({
      ...payment,
      invoiceNumber: payment.invoice.invoiceNumber,
    }));
    const corrections = correctionRows.map((correction) => ({
      ...correction,
      invoiceNumber: correction.invoice.invoiceNumber,
    }));
    const completed = payments.filter((item) => item.status === "Completed");
    const executed = corrections.filter(
      (item) =>
        item.status === "Executed" &&
        item.executedAt &&
        item.executedAt >= startsAt &&
        item.executedAt < endsAt,
    );
    const requestedPending = corrections.filter(
      (item) =>
        item.status === "PendingApproval" &&
        item.requestedAt >= startsAt &&
        item.requestedAt < endsAt,
    );
    const byMethod = Object.values(PaymentMethod).map((method) => ({
      method,
      collectedNpr: this.money(
        completed
          .filter((item) => item.method === method)
          .reduce((sum, item) => sum.plus(item.amount), ZERO),
      ),
      count: completed.filter((item) => item.method === method).length,
    }));
    const exceptions = [
      ...payments
        .filter(
          (item) =>
            NON_CASH_METHODS.has(item.method) &&
            !item.referenceNumber?.trim(),
        )
        .map((item) => ({
          id: `missing-reference:${item.id}`,
          type: "missing_reference",
          severity: "warning",
          invoiceId: item.invoiceId,
          invoiceNumber: item.invoiceNumber,
          paymentId: item.id,
          message: "Non-cash payment has no reconciliation reference.",
        })),
      ...payments
        .filter((item) => ["Pending", "Failed"].includes(item.status))
        .map((item) => ({
          id: `payment-state:${item.id}`,
          type:
            item.status === "Pending"
              ? "pending_payment"
              : "failed_payment",
          severity: item.status === "Pending" ? "warning" : "error",
          invoiceId: item.invoiceId,
          invoiceNumber: item.invoiceNumber,
          paymentId: item.id,
          message: `Payment remains ${item.status.toLowerCase()}.`,
        })),
      ...requestedPending
        .map((item) => ({
          id: `pending-correction:${item.id}`,
          type: "pending_correction",
          severity: "warning",
          invoiceId: item.invoiceId,
          invoiceNumber: item.invoiceNumber,
          correctionId: item.id,
          message: "Financial correction is awaiting distinct approval.",
        })),
    ];
    return {
      date: query.date,
      locationId: query.locationId ?? null,
      totals: {
        issuedNpr: this.money(
          issuedSummary._sum.totalAmount ?? ZERO,
        ),
        collectedNpr: this.money(
          completed.reduce((sum, item) => sum.plus(item.amount), ZERO),
        ),
        correctedNpr: this.money(
          executed.reduce((sum, item) => sum.plus(item.amount), ZERO),
        ),
        outstandingNpr: this.money(
          outstandingSummary._sum.balanceAmount ?? ZERO,
        ),
        pendingApprovalCount: requestedPending.length,
      },
      byMethod,
      exceptions,
    };
  }

  private async decideCorrection(
    id: string,
    expectedVersion: number,
    decision: "approve" | "reject",
    rejectionReason: string | null,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    const scope = this.financeScope(actor, undefined, APPROVAL_ROLES);
    const initial = await this.prisma.financialCorrection.findFirst({
      where: {
        id,
        organizationId: actor.organizationId,
        ...(scope.locationWhere ? { locationId: scope.locationWhere } : {}),
      },
      select: {
        id: true,
        invoiceId: true,
        locationId: true,
        initiatedByUserId: true,
      },
    });
    if (!initial) throw new NotFoundException("Financial correction not found");
    if (decision === "approve" && initial.initiatedByUserId === actor.id) {
      throw new ForbiddenException({
        code: "CORRECTION_SELF_APPROVAL_DENIED",
        message: "A financial correction requires a different approver.",
      });
    }
    const correction = await this.serializable(async (tx) => {
      await this.lockInvoice(tx, actor.organizationId, initial.invoiceId);
      await this.lockCorrection(tx, actor.organizationId, id);
      const current = await tx.financialCorrection.findFirst({
        where: { id, organizationId: actor.organizationId },
        include: { payment: { include: { corrections: true } } },
      });
      if (!current) throw new NotFoundException("Financial correction not found");
      if (
        current.status !== "PendingApproval" ||
        current.version !== expectedVersion
      ) {
        throw this.conflict(
          "CORRECTION_VERSION_CHANGED",
          "The correction changed before this decision.",
        );
      }
      const now = new Date();
      if (decision === "approve") {
        if (!current.payment) {
          throw this.conflict(
            "CORRECTION_NOT_APPROVABLE",
            "The correction is not linked to a payment.",
          );
        }
        const alreadyExecuted = current.payment.corrections
          .filter(
            (item) =>
              item.id !== current.id && item.status === "Executed",
          )
          .reduce((sum, item) => sum.plus(item.amount), ZERO);
        if (
          alreadyExecuted.plus(current.amount).greaterThan(
            current.payment.amount,
          )
        ) {
          throw this.conflict(
            "CORRECTION_EXCEEDS_AVAILABLE",
            "The payment no longer has enough correctable value.",
          );
        }
        const updated = await tx.financialCorrection.update({
          where: { id },
          data: {
            status: "Executed",
            approvedByUserId: actor.id,
            approvedAt: now,
            executedAt: now,
            version: { increment: 1 },
          },
        });
        await this.recalculateInvoice(tx, current.invoiceId);
        await this.auditDecision(tx, actor, updated, "approved", null);
        return updated;
      }
      const updated = await tx.financialCorrection.update({
        where: { id },
        data: {
          status: "Rejected",
          rejectedByUserId: actor.id,
          rejectedAt: now,
          version: { increment: 1 },
          metadata: {
            rejectionReason,
          },
        },
      });
      await this.auditDecision(
        tx,
        actor,
        updated,
        "rejected",
        rejectionReason,
      );
      return updated;
    });
    return { correction: this.mapCorrection(correction) };
  }

  private async auditDecision(
    tx: Prisma.TransactionClient,
    actor: AuthSession,
    correction: {
      id: string;
      invoiceId: string;
      paymentId: string | null;
      status: FinancialCorrectionStatus;
      version: number;
    },
    action: string,
    reason: string | null,
  ) {
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        entityType: "financial_correction",
        entityId: correction.id,
        action,
        oldValue: { status: "PendingApproval" },
        newValue: {
          invoiceId: correction.invoiceId,
          paymentId: correction.paymentId,
          status: correction.status,
          version: correction.version,
          ...(reason ? { reason } : {}),
        },
        description: `Financial correction ${action}`,
      },
    });
  }

  private async recalculateInvoice(
    tx: Prisma.TransactionClient,
    invoiceId: string,
  ) {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { payments: true, corrections: true },
    });
    const completed = invoice.payments
      .filter((item) => item.status === "Completed")
      .reduce((sum, item) => sum.plus(item.amount), ZERO);
    const corrected = invoice.corrections
      .filter((item) => item.status === "Executed")
      .reduce((sum, item) => sum.plus(item.amount), ZERO);
    const effectivePaid = completed.minus(corrected);
    const balance = invoice.totalAmount.minus(effectivePaid);
    const status: InvoiceStatus =
      effectivePaid.greaterThanOrEqualTo(invoice.totalAmount) &&
      invoice.totalAmount.greaterThan(0)
        ? "Paid"
        : effectivePaid.greaterThan(0)
          ? "PartiallyPaid"
          : "Issued";
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { balanceAmount: balance, status },
    });
  }

  private async normalizeInvoiceLines(
    organizationId: string,
    dto: CreateFinanceInvoiceDto,
  ) {
    let input = dto.lineItems;
    if (!input.length && dto.appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          id: dto.appointmentId,
          organizationId,
          customerId: dto.clientId,
          locationId: dto.locationId,
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
        throw this.conflict(
          "APPOINTMENT_UNAVAILABLE",
          "The selected appointment is unavailable for this invoice.",
        );
      }
      input = appointment.services.map(({ service }) => ({
        serviceId: service.id,
        description: service.name,
        quantity: 1,
        unitPriceNpr: this.money(service.price ?? ZERO),
      }));
    }
    if (!input.length) {
      throw new BadRequestException("Invoice requires at least one line item");
    }
    const serviceIds = [
      ...new Set(
        input
          .map((item) => item.serviceId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (serviceIds.length) {
      const count = await this.prisma.service.count({
        where: { id: { in: serviceIds }, organizationId, isActive: true },
      });
      if (count !== serviceIds.length) {
        throw this.conflict(
          "SERVICE_UNAVAILABLE",
          "One or more invoice services are unavailable.",
        );
      }
    }
    return input.map((item) => {
      const unitPrice = new Prisma.Decimal(item.unitPriceNpr);
      const discount = new Prisma.Decimal(item.discountNpr ?? 0);
      const tax = new Prisma.Decimal(item.taxNpr ?? 0);
      const gross = unitPrice.times(item.quantity);
      if (
        unitPrice.isNegative() ||
        discount.isNegative() ||
        tax.isNegative() ||
        discount.greaterThan(gross) ||
        gross.minus(discount).plus(tax).isNegative()
      ) {
        throw new BadRequestException("Invoice line amounts are invalid");
      }
      return {
        serviceId: item.serviceId,
        description: item.description.trim(),
        quantity: item.quantity,
        unitPrice,
        discount,
        tax,
      };
    });
  }

  private summary(
    invoices: Array<{
      status: InvoiceStatus;
      totalAmount: Prisma.Decimal;
      balanceAmount: Prisma.Decimal;
      payments: Array<{ amount: Prisma.Decimal; status: string }>;
      corrections: Array<{
        amount: Prisma.Decimal;
        status: FinancialCorrectionStatus;
      }>;
    }>,
  ) {
    return {
      issuedNpr: this.money(
        invoices
          .filter((item) => item.status !== "Draft" && item.status !== "Void")
          .reduce((sum, item) => sum.plus(item.totalAmount), ZERO),
      ),
      collectedNpr: this.money(
        invoices
          .flatMap((item) => item.payments)
          .filter((item) => item.status === "Completed")
          .reduce((sum, item) => sum.plus(item.amount), ZERO),
      ),
      correctedNpr: this.money(
        invoices
          .flatMap((item) => item.corrections)
          .filter((item) => item.status === "Executed")
          .reduce((sum, item) => sum.plus(item.amount), ZERO),
      ),
      outstandingNpr: this.money(
        invoices.reduce((sum, item) => sum.plus(item.balanceAmount), ZERO),
      ),
      pendingApprovalCount: invoices
        .flatMap((item) => item.corrections)
        .filter((item) => item.status === "PendingApproval").length,
    };
  }

  private capabilities(roles: readonly string[]) {
    return {
      canCreateDraft: roles.some((role) => DRAFT_ROLES.has(role)),
      canIssue: roles.some((role) => ISSUE_ROLES.has(role)),
      canRecordPayment: roles.some((role) => PAYMENT_ROLES.has(role)),
      canInitiateCorrection: roles.some((role) =>
        CORRECTION_ROLES.has(role),
      ),
      canApproveCorrection: roles.some((role) => APPROVAL_ROLES.has(role)),
      canReconcile: roles.some((role) => RECONCILIATION_ROLES.has(role)),
    };
  }

  private rolesAt(actor: AuthSession, locationId: string | null) {
    if (locationId) return effectiveRoleUnionForLocation(actor, locationId);
    if (!actor.effectiveRoleScopes) return effectiveRoleUnion(actor);
    return actor.effectiveRoleScopes
      .filter((scope) => scope.locationId === null)
      .map((scope) => scope.role);
  }

  private allowedLocationIds(
    actor: AuthSession,
    roles: ReadonlySet<string>,
  ): string[] | null {
    if (!actor.effectiveRoleScopes) {
      return effectiveRoleUnion(actor).some((role) => roles.has(role))
        ? null
        : [];
    }
    if (
      actor.effectiveRoleScopes.some(
        (scope) => scope.locationId === null && roles.has(scope.role),
      )
    ) {
      return null;
    }
    return [
      ...new Set(
        actor.effectiveRoleScopes
          .filter(
            (scope) =>
              scope.locationId !== null && roles.has(scope.role),
          )
          .map((scope) => scope.locationId!),
      ),
    ];
  }

  private financeScope(
    actor: AuthSession,
    locationId: string | undefined,
    roles: ReadonlySet<string>,
  ): FinanceScope {
    if (locationId) {
      const scopedRoles = effectiveRoleUnionForLocation(actor, locationId);
      if (!scopedRoles.some((role) => roles.has(role))) {
        throw new ForbiddenException("Finance access is not allowed at this location");
      }
      return {
        roles: [...scopedRoles],
        locationWhere: { equals: locationId },
      };
    }
    if (!actor.effectiveRoleScopes) {
      const union = effectiveRoleUnion(actor);
      if (!union.some((role) => roles.has(role))) {
        throw new ForbiddenException("Finance access is not allowed");
      }
      return { roles: [...union] };
    }
    const organizationRoles = actor.effectiveRoleScopes
      .filter((scope) => scope.locationId === null && roles.has(scope.role))
      .map((scope) => scope.role);
    if (organizationRoles.length) return { roles: organizationRoles };
    const scoped = actor.effectiveRoleScopes.filter(
      (scope) => scope.locationId && roles.has(scope.role),
    );
    if (!scoped.length) {
      throw new ForbiddenException("Finance access is not allowed");
    }
    return {
      roles: [...new Set(scoped.map((scope) => scope.role))],
      locationWhere: {
        in: [...new Set(scoped.map((scope) => scope.locationId!))],
      },
    };
  }

  private requireAnyRole(
    actor: AuthSession,
    locationId: string | null | undefined,
    roles: ReadonlySet<string>,
  ) {
    if (!this.hasAnyRoleAt(actor, locationId, roles)) {
      throw new ForbiddenException("You are not allowed to perform this finance action");
    }
  }

  private hasAnyRoleAt(
    actor: AuthSession,
    locationId: string | null | undefined,
    roles: ReadonlySet<string>,
  ) {
    return this.rolesAt(actor, locationId ?? null).some((role) =>
      roles.has(role),
    );
  }

  private async assertLocation(organizationId: string, locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!location) throw new NotFoundException("Finance location not found");
  }

  private async findPaymentReplay(
    actor: AuthSession,
    idempotencyKey: string,
  ) {
    return this.prisma.payment.findUnique({
      where: {
        organizationId_recordedByUserId_idempotencyKey: {
          organizationId: actor.organizationId,
          recordedByUserId: actor.id,
          idempotencyKey,
        },
      },
    });
  }

  private async findCorrectionReplay(
    actor: AuthSession,
    idempotencyKey: string,
  ) {
    return this.prisma.financialCorrection.findUnique({
      where: {
        organizationId_initiatedByUserId_idempotencyKey: {
          organizationId: actor.organizationId,
          initiatedByUserId: actor.id,
          idempotencyKey,
        },
      },
    });
  }

  private assertReplay(
    storedHash: string | null,
    requestHash: string,
  ) {
    if (storedHash !== requestHash) {
      throw this.conflict(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used for different content.",
      );
    }
  }

  private amount(value: string) {
    const amount = new Prisma.Decimal(value);
    if (!amount.isPositive() || amount.decimalPlaces() > 2) {
      throw new BadRequestException("NPR amount must be positive with at most two decimals");
    }
    return amount;
  }

  private money(value: Prisma.Decimal) {
    return value.toFixed(2);
  }

  private hash(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private async lockIdempotency(
    tx: Prisma.TransactionClient,
    key: string,
  ) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }

  private async lockInvoice(
    tx: Prisma.TransactionClient,
    organizationId: string,
    invoiceId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Invoice"
      WHERE "id" = ${invoiceId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new NotFoundException("Invoice not found");
  }

  private async lockPayment(
    tx: Prisma.TransactionClient,
    organizationId: string,
    paymentId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Payment"
      WHERE "id" = ${paymentId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new NotFoundException("Payment not found");
  }

  private async lockCorrection(
    tx: Prisma.TransactionClient,
    organizationId: string,
    correctionId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "FinancialCorrection"
      WHERE "id" = ${correctionId} AND "organizationId" = ${organizationId}
      FOR UPDATE
    `);
    if (rows.length !== 1) {
      throw new NotFoundException("Financial correction not found");
    }
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!this.isRetryableTransaction(error) || attempt === 2) throw error;
      }
    }
    throw new ConflictException("Finance transaction could not be completed");
  }

  private isRetryableTransaction(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2034" ||
        (error.code === "P2010" &&
          JSON.stringify(error.meta).includes("40001")))
    );
  }

  private mapPayment(payment: {
    id: string;
    invoiceId: string;
    locationId: string | null;
    amount: Prisma.Decimal;
    currency: string;
    method: PaymentMethod;
    status: string;
    referenceNumber: string | null;
    paidAt: Date;
  }) {
    return {
      id: payment.id,
      invoiceId: payment.invoiceId,
      locationId: payment.locationId,
      amountNpr: this.money(payment.amount),
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      referenceNumber: payment.referenceNumber,
      paidAtIso: payment.paidAt.toISOString(),
    };
  }

  private mapInvoiceCommand(invoice: {
    id: string;
    invoiceNumber: string;
    customerId: string;
    locationId: string | null;
    status: InvoiceStatus;
    currency: string;
    issuedAt: Date;
    dueAt: Date | null;
    totalAmount: Prisma.Decimal;
    balanceAmount: Prisma.Decimal;
  }) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      clientId: invoice.customerId,
      locationId: invoice.locationId,
      status: invoice.status,
      currency: invoice.currency,
      issuedAtIso: invoice.issuedAt.toISOString(),
      dueAtIso: invoice.dueAt?.toISOString() ?? null,
      totalNpr: this.money(invoice.totalAmount),
      balanceNpr: this.money(invoice.balanceAmount),
    };
  }

  private mapCorrection(correction: {
    id: string;
    invoiceId: string;
    paymentId: string | null;
    locationId: string | null;
    kind: FinancialCorrectionKind;
    status: FinancialCorrectionStatus;
    amount: Prisma.Decimal;
    currency: string;
    reason: string;
    initiatedByUserId: string;
    approvedByUserId: string | null;
    rejectedByUserId: string | null;
    requestedAt: Date;
    approvedAt: Date | null;
    rejectedAt: Date | null;
    executedAt: Date | null;
    version: number;
  }) {
    return {
      id: correction.id,
      invoiceId: correction.invoiceId,
      paymentId: correction.paymentId,
      locationId: correction.locationId,
      kind: correction.kind,
      status: correction.status,
      amountNpr: this.money(correction.amount),
      currency: correction.currency,
      reason: correction.reason,
      initiatedByUserId: correction.initiatedByUserId,
      approvedByUserId: correction.approvedByUserId,
      rejectedByUserId: correction.rejectedByUserId,
      requestedAtIso: correction.requestedAt.toISOString(),
      approvedAtIso: correction.approvedAt?.toISOString() ?? null,
      rejectedAtIso: correction.rejectedAt?.toISOString() ?? null,
      executedAtIso: correction.executedAt?.toISOString() ?? null,
      version: correction.version,
    };
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }
}
