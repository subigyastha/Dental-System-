import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { HttpException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { loadMonorepoEnv } from "../env-bootstrap";
import { FinanceLedgerService } from "../modules/api-v1/finance-ledger.service";

const databaseUrl = process.env.FINANCE_TEST_DATABASE_URL;

test(
  "finance ledger prevents concurrent overcollection and over-reservation in PostgreSQL",
  { skip: databaseUrl ? false : "Set FINANCE_TEST_DATABASE_URL to run" },
  async () => {
    process.env.DATABASE_URL = databaseUrl;
    loadMonorepoEnv();
    const prisma = new PrismaClient();
    const prefix = `finance-${randomUUID()}`;
    const organizationId = `${prefix}-organization`;
    const locationId = `${prefix}-location`;
    const actorUserId = `${prefix}-actor`;
    const customerId = `${prefix}-client`;
    const invoiceId = `${prefix}-invoice`;
    const actor = {
      id: actorUserId,
      organizationId,
      role: "Finance",
      effectiveRoles: ["Finance"],
      effectiveRoleScopes: [{ role: "Finance", locationId }],
      name: "Finance integration actor",
      email: `${prefix}@example.test`,
    };
    const auth = { requireSession: async () => actor };
    const service = new FinanceLedgerService(prisma as never, auth as never);

    try {
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: "Finance integration clinic",
          settings: {
            create: {
              financeCorrectionApprovalThresholdNpr: new Prisma.Decimal(0),
            },
          },
        },
      });
      await prisma.location.create({
        data: {
          id: locationId,
          organizationId,
          name: "Finance integration location",
        },
      });
      await prisma.user.create({
        data: {
          id: actorUserId,
          organizationId,
          name: actor.name,
          email: actor.email,
          role: "Finance",
        },
      });
      await prisma.customer.create({
        data: {
          id: customerId,
          organizationId,
          fullName: "Finance integration client",
          phone: "9800000099",
          normalizedPhone: "9779800000099",
        },
      });
      await prisma.invoice.create({
        data: {
          id: invoiceId,
          organizationId,
          customerId,
          locationId,
          invoiceNumber: `${prefix}-INV-1`,
          status: "Issued",
          subtotal: new Prisma.Decimal("100.00"),
          totalAmount: new Prisma.Decimal("100.00"),
          balanceAmount: new Prisma.Decimal("100.00"),
          lineItems: {
            create: {
              description: "Concurrency fixture",
              quantity: 1,
              unitPrice: new Prisma.Decimal("100.00"),
              lineTotal: new Prisma.Decimal("100.00"),
            },
          },
        },
      });

      const paymentResults = await Promise.allSettled([
        service.recordPayment(
          invoiceId,
          {
            locationId,
            amountNpr: "60.00",
            method: "Cash",
          },
          `${prefix}-payment-1`,
          actor,
        ),
        service.recordPayment(
          invoiceId,
          {
            locationId,
            amountNpr: "60.00",
            method: "Cash",
          },
          `${prefix}-payment-2`,
          actor,
        ),
      ]);
      assertSingleWinner(paymentResults, "PAYMENT_EXCEEDS_BALANCE");

      const durablePayments = await prisma.payment.findMany({
        where: { organizationId, invoiceId },
        orderBy: { id: "asc" },
      });
      assert.equal(durablePayments.length, 1);
      assert.equal(durablePayments[0]?.amount.toFixed(2), "60.00");

      const afterPayment = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      assert.equal(afterPayment.status, "PartiallyPaid");
      assert.equal(afterPayment.balanceAmount.toFixed(2), "40.00");

      const paymentId = durablePayments[0]!.id;
      const correctionResults = await Promise.allSettled([
        service.requestCorrection(
          invoiceId,
          paymentId,
          {
            amountNpr: "40.00",
            kind: "Refund",
            reason: "Concurrent correction fixture one",
          },
          `${prefix}-correction-1`,
          actor,
        ),
        service.requestCorrection(
          invoiceId,
          paymentId,
          {
            amountNpr: "40.00",
            kind: "Refund",
            reason: "Concurrent correction fixture two",
          },
          `${prefix}-correction-2`,
          actor,
        ),
      ]);
      assertSingleWinner(
        correctionResults,
        "CORRECTION_EXCEEDS_AVAILABLE",
      );

      const durableCorrections = await prisma.financialCorrection.findMany({
        where: { organizationId, invoiceId, paymentId },
        orderBy: { id: "asc" },
      });
      assert.equal(durableCorrections.length, 1);
      assert.equal(durableCorrections[0]?.status, "PendingApproval");
      assert.equal(durableCorrections[0]?.amount.toFixed(2), "40.00");

      const durableInvoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      assert.equal(
        durableInvoice.balanceAmount.toFixed(2),
        "40.00",
        "a pending correction must reserve value without changing the ledger balance",
      );

      const durableAudits = await prisma.auditLog.findMany({
        where: {
          organizationId,
          OR: [
            { entityType: "payment", action: "recorded" },
            { entityType: "financial_correction", action: "requested" },
          ],
        },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(durableAudits.length, 2);
      assert.deepEqual(
        durableAudits.map((row) => `${row.entityType}:${row.action}`).sort(),
        ["financial_correction:requested", "payment:recorded"],
      );
      assert.equal(
        durableAudits.find((row) => row.entityType === "payment")?.entityId,
        paymentId,
      );
      assert.equal(
        durableAudits.find(
          (row) => row.entityType === "financial_correction",
        )?.entityId,
        durableCorrections[0]?.id,
      );
    } finally {
      await prisma.financialCorrection.deleteMany({
        where: { organizationId },
      });
      await prisma.auditLog.deleteMany({ where: { organizationId } });
      await prisma.payment.deleteMany({ where: { organizationId } });
      await prisma.invoice.deleteMany({ where: { organizationId } });
      await prisma.customer.deleteMany({ where: { organizationId } });
      await prisma.user.deleteMany({
        where: { id: actorUserId, organizationId },
      });
      await prisma.location.deleteMany({ where: { organizationId } });
      await prisma.organizationSetting.deleteMany({
        where: { organizationId },
      });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.$disconnect();
    }
  },
);

function assertSingleWinner(
  results: PromiseSettledResult<unknown>[],
  expectedRejectedCode: string,
) {
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
    JSON.stringify(
      results.map((result) =>
        result.status === "fulfilled"
          ? { status: result.status }
          : {
              status: result.status,
              code: domainCode(result.reason),
              name:
                result.reason instanceof Error
                  ? result.reason.constructor.name
                  : typeof result.reason,
              message:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            },
      ),
    ),
  );
  const rejected = results.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected",
  );
  assert.equal(domainCode(rejected?.reason), expectedRejectedCode);
}

function domainCode(error: unknown) {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  if (!response || typeof response !== "object" || !("code" in response)) {
    return undefined;
  }
  return typeof response.code === "string" ? response.code : undefined;
}
