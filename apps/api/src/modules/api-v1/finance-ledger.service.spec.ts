import assert from "node:assert/strict";
import test from "node:test";

import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { FinanceLedgerService } from "./finance-ledger.service";

const ZERO_FOR_TEST = new Prisma.Decimal(0);

const financeActor = {
  id: "finance-a",
  organizationId: "clinic-a",
  name: "Finance User",
  email: "finance@example.test",
  role: "Finance",
  effectiveRoles: ["Finance"],
  effectiveRoleScopes: [{ role: "Finance", locationId: "location-a" }],
};

const paymentReplay = {
  id: "payment-a",
  organizationId: "clinic-a",
  invoiceId: "invoice-a",
  customerId: "client-a",
  appointmentId: null,
  locationId: "location-a",
  amount: new Prisma.Decimal("100.00"),
  currency: "NPR",
  method: "Cash" as const,
  status: "Completed" as const,
  referenceNumber: null,
  paidAt: new Date("2030-01-01T04:15:00.000Z"),
  notes: null,
  metadata: null,
  recordedByUserId: "finance-a",
  idempotencyKey: "payment-key-0001",
  requestHash: "",
  createdAt: new Date("2030-01-01T04:15:00.000Z"),
  updatedAt: new Date("2030-01-01T04:15:00.000Z"),
};

function serviceWith(prisma: Record<string, unknown>, actor = financeActor) {
  return new FinanceLedgerService(
    prisma as never,
    { requireSession: async () => actor } as never,
  );
}

test("Scheduler is denied the finance workspace", async () => {
  const scheduler = {
    ...financeActor,
    role: "Scheduler",
    effectiveRoles: ["Scheduler"],
    effectiveRoleScopes: [{ role: "Scheduler", locationId: "location-a" }],
  };
  const service = serviceWith({}, scheduler);
  await assert.rejects(
    service.workspace({ locationId: "location-a" }, scheduler),
    ForbiddenException,
  );
});

test("non-cash payment requires a reconciliation reference before any write", async () => {
  const service = serviceWith({
    location: { findFirst: async () => ({ id: "location-a" }) },
  });
  await assert.rejects(
    service.recordPayment(
      "invoice-a",
      {
        locationId: "location-a",
        amountNpr: "100.00",
        method: "BankTransfer",
      },
      "payment-key-0001",
      financeActor,
    ),
    (error) => {
      assert.equal(error instanceof Error ? error.message : "", "A reference is required for this payment method.");
      return true;
    },
  );
});

test("payment idempotency replay returns the durable receipt without a transaction", async () => {
  const dto = {
    locationId: "location-a",
    amountNpr: "100.00",
    method: "Cash" as const,
  };
  const expectedHash = (
    serviceWith({}) as unknown as {
      hash(value: unknown): string;
    }
  ).hash({
    invoiceId: "invoice-a",
    locationId: "location-a",
    amountNpr: "100.00",
    method: "Cash",
    paidAtIso: null,
    referenceNumber: null,
    notes: null,
  });
  let transactions = 0;
  const service = serviceWith({
    location: { findFirst: async () => ({ id: "location-a" }) },
    payment: {
      findUnique: async () => ({ ...paymentReplay, requestHash: expectedHash }),
    },
    $transaction: async () => {
      transactions += 1;
      throw new Error("must not transact");
    },
  });
  const result = await service.recordPayment(
    "invoice-a",
    dto,
    "payment-key-0001",
    financeActor,
  );
  assert.equal(result.replayed, true);
  assert.equal(result.payment.id, "payment-a");
  assert.equal(transactions, 0);
});

test("same payment key with changed content is rejected", async () => {
  const service = serviceWith({
    location: { findFirst: async () => ({ id: "location-a" }) },
    payment: {
      findUnique: async () => ({ ...paymentReplay, requestHash: "other" }),
    },
  });
  await assert.rejects(
    service.recordPayment(
      "invoice-a",
      {
        locationId: "location-a",
        amountNpr: "100.00",
        method: "Cash",
      },
      "payment-key-0001",
      financeActor,
    ),
    (error) => {
      assert.ok(error instanceof ConflictException);
      assert.match(error.message, /different content/);
      return true;
    },
  );
});

test("location-scoped payment recording fails closed for a legacy invoice without a location", async () => {
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: "locked" }],
    payment: { findUnique: async () => null },
    invoice: {
      findFirst: async () => ({
        id: "invoice-a",
        organizationId: "clinic-a",
        locationId: null,
        status: "Issued",
        balanceAmount: new Prisma.Decimal("100.00"),
        customerId: "client-a",
        appointmentId: null,
      }),
    },
  };
  const service = serviceWith({
    location: { findFirst: async () => ({ id: "location-a" }) },
    payment: { findUnique: async () => null },
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
  });

  await assert.rejects(
    service.recordPayment(
      "invoice-a",
      {
        locationId: "location-a",
        amountNpr: "10.00",
        method: "Cash",
      },
      "payment-location-key-01",
      financeActor,
    ),
    (error) => {
      assert.ok(error instanceof ConflictException);
      assert.match(error.message, /Assign this legacy invoice/);
      return true;
    },
  );
});

test("pending and executed corrections reserve the remaining correctable amount", async () => {
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: "locked" }],
    financialCorrection: { findUnique: async () => null },
    payment: {
      findFirst: async () => ({
        id: "payment-a",
        invoiceId: "invoice-a",
        organizationId: "clinic-a",
        locationId: "location-a",
        amount: new Prisma.Decimal("100.00"),
        status: "Completed",
        corrections: [
          {
            amount: new Prisma.Decimal("80.00"),
            status: "PendingApproval",
          },
        ],
      }),
    },
  };
  const service = serviceWith({
    payment: {
      findFirst: async () => ({ id: "payment-a", locationId: "location-a" }),
    },
    financialCorrection: { findUnique: async () => null },
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
  });
  await assert.rejects(
    service.requestCorrection(
      "invoice-a",
      "payment-a",
      {
        amountNpr: "30.00",
        kind: "Refund",
        reason: "Duplicate collection",
      },
      "correction-key-01",
      financeActor,
    ),
    (error) => {
      assert.ok(error instanceof ConflictException);
      assert.match(error.message, /remaining correctable/);
      return true;
    },
  );
});

test("the fail-safe zero threshold creates a pending correction without changing balance", async () => {
  let invoiceUpdated = false;
  const createdAt = new Date("2030-01-01T04:15:00.000Z");
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: "locked" }],
    financialCorrection: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "correction-a",
        invoiceId: "invoice-a",
        paymentId: "payment-a",
        locationId: "location-a",
        kind: "Refund",
        status: data.status,
        amount: new Prisma.Decimal("20.00"),
        currency: "NPR",
        reason: "Duplicate collection",
        initiatedByUserId: "finance-a",
        approvedByUserId: null,
        rejectedByUserId: null,
        requestedAt: createdAt,
        approvedAt: null,
        rejectedAt: null,
        executedAt: null,
        version: 1,
      }),
    },
    payment: {
      findFirst: async () => ({
        id: "payment-a",
        invoiceId: "invoice-a",
        organizationId: "clinic-a",
        locationId: "location-a",
        amount: new Prisma.Decimal("100.00"),
        status: "Completed",
        corrections: [],
      }),
    },
    organizationSetting: {
      findUnique: async () => ({
        financeCorrectionApprovalThresholdNpr: new Prisma.Decimal(0),
      }),
    },
    invoice: {
      update: async () => {
        invoiceUpdated = true;
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const service = serviceWith({
    payment: {
      findFirst: async () => ({ id: "payment-a", locationId: "location-a" }),
    },
    financialCorrection: { findUnique: async () => null },
    $transaction: async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
  });
  const result = await service.requestCorrection(
    "invoice-a",
    "payment-a",
    {
      amountNpr: "20.00",
      kind: "Refund",
      reason: "Duplicate collection",
    },
    "correction-key-01",
    financeActor,
  );
  assert.equal(result.correction.status, "PendingApproval");
  assert.equal(invoiceUpdated, false);
});

test("an Owner cannot approve a correction they initiated", async () => {
  const owner = {
    ...financeActor,
    id: "owner-a",
    role: "Owner",
    effectiveRoles: ["Owner", "Finance"],
    effectiveRoleScopes: [
      { role: "Owner", locationId: "location-a" },
      { role: "Finance", locationId: "location-a" },
    ],
  };
  const service = serviceWith(
    {
      financialCorrection: {
        findFirst: async () => ({
          id: "correction-a",
          invoiceId: "invoice-a",
          locationId: "location-a",
          initiatedByUserId: "owner-a",
        }),
      },
    },
    owner,
  );
  await assert.rejects(
    service.approveCorrection(
      "correction-a",
      { expectedVersion: 1 },
      owner,
    ),
    (error) => {
      assert.ok(error instanceof ForbiddenException);
      assert.match(error.message, /different approver/);
      return true;
    },
  );
});

test("workspace exposes gross collections separately from executed corrections", async () => {
  let observedWhere: unknown;
  const service = serviceWith({
    location: { findFirst: async () => ({ id: "location-a" }) },
    invoice: {
      findMany: async (args: { where: unknown }) => {
        observedWhere = args.where;
        return [
        {
          id: "invoice-a",
          invoiceNumber: "INV-00001",
          customerId: "client-a",
          locationId: "location-a",
          status: "PartiallyPaid",
          issuedAt: new Date("2030-01-01T00:00:00.000Z"),
          dueAt: null,
          totalAmount: new Prisma.Decimal("200.00"),
          balanceAmount: new Prisma.Decimal("120.00"),
          customer: {
            id: "client-a",
            fullName: "Asha Rai",
            patientCode: "CL-000001",
          },
          payments: [
            { amount: new Prisma.Decimal("100.00"), status: "Completed" },
          ],
          corrections: [
            {
              amount: new Prisma.Decimal("20.00"),
              status: "Executed",
            },
            {
              amount: new Prisma.Decimal("10.00"),
              status: "PendingApproval",
            },
          ],
        },
      ];
      },
    },
  });
  const result = await service.workspace(
    { locationId: "location-a", clientId: "client-a" },
    financeActor,
  );
  assert.equal(result.invoices[0]?.collectedNpr, "100.00");
  assert.equal(result.invoices[0]?.correctedNpr, "20.00");
  assert.deepEqual(observedWhere, {
    organizationId: "clinic-a",
    locationId: { equals: "location-a" },
    customerId: "client-a",
  });
});

test("workspace returns invoice capabilities for each assigned location", async () => {
  const mixedActor = {
    ...financeActor,
    role: "Receptionist",
    effectiveRoles: ["Receptionist", "Finance"],
    effectiveRoleScopes: [
      { role: "Receptionist", locationId: "location-a" },
      { role: "Finance", locationId: "location-b" },
    ],
  };
  const invoice = (id: string, locationId: string) => ({
    id,
    invoiceNumber: id,
    customerId: "client-a",
    locationId,
    status: "Issued" as const,
    issuedAt: new Date("2030-01-01T00:00:00.000Z"),
    dueAt: null,
    totalAmount: new Prisma.Decimal("100.00"),
    balanceAmount: new Prisma.Decimal("100.00"),
    customer: {
      id: "client-a",
      fullName: "Asha Rai",
      patientCode: "CL-000001",
    },
    payments: [],
    corrections: [],
  });
  const service = serviceWith({
    invoice: {
      findMany: async () => [
        invoice("invoice-a", "location-a"),
        invoice("invoice-b", "location-b"),
      ],
    },
  }, mixedActor);

  const result = await service.workspace({}, mixedActor);
  assert.equal(result.invoices[0]?.capabilities.canIssue, false);
  assert.equal(result.invoices[0]?.capabilities.canInitiateCorrection, false);
  assert.equal(result.invoices[1]?.capabilities.canIssue, true);
  assert.equal(result.invoices[1]?.capabilities.canInitiateCorrection, true);
  assert.deepEqual(result.createLocationIds?.sort(), [
    "location-a",
    "location-b",
  ]);
});

test("payment ledger reports server-computed correctable value after pending and executed corrections", async () => {
  const service = serviceWith({
    invoice: {
      findFirst: async () => ({
        id: "invoice-a",
        invoiceNumber: "INV-00001",
        customerId: "client-a",
        locationId: "location-a",
        status: "PartiallyPaid",
        currency: "NPR",
        issuedAt: new Date("2030-01-01T00:00:00.000Z"),
        dueAt: null,
        subtotal: new Prisma.Decimal("100.00"),
        discountAmount: ZERO_FOR_TEST,
        taxAmount: ZERO_FOR_TEST,
        totalAmount: new Prisma.Decimal("100.00"),
        balanceAmount: new Prisma.Decimal("50.00"),
        notes: null,
        customer: {
          id: "client-a",
          fullName: "Asha Rai",
          patientCode: "CL-000001",
        },
        lineItems: [],
        payments: [
          {
            id: "payment-a",
            invoiceId: "invoice-a",
            amount: new Prisma.Decimal("100.00"),
            status: "Completed",
            method: "Cash",
            paidAt: new Date("2030-01-01T01:00:00.000Z"),
            referenceNumber: null,
            corrections: [
              { amount: new Prisma.Decimal("20.00"), status: "Executed" },
              {
                amount: new Prisma.Decimal("30.00"),
                status: "PendingApproval",
              },
              { amount: new Prisma.Decimal("10.00"), status: "Rejected" },
            ],
          },
        ],
        corrections: [],
      }),
    },
  });
  const result = await service.invoiceDetail("invoice-a", financeActor);
  const payment = result.ledger.find((item) => item.type === "payment");
  assert.ok(payment && "correctableNpr" in payment);
  assert.equal(payment.correctableNpr, "50.00");
});

test("reconciliation attributes executed corrections by executedAt, not request date", async () => {
  let observedCorrectionWhere: unknown;
  const observedInvoiceWheres: unknown[] = [];
  const service = serviceWith({
    invoice: {
      aggregate: async ({ where, _sum }: { where: unknown; _sum: Record<string, boolean> }) => {
        observedInvoiceWheres.push(where);
        return {
          _sum: _sum.totalAmount
            ? { totalAmount: new Prisma.Decimal("0.00") }
            : { balanceAmount: new Prisma.Decimal("20.00") },
        };
      },
    },
    payment: { findMany: async () => [] },
    financialCorrection: {
      findMany: async ({ where }: { where: unknown }) => {
        observedCorrectionWhere = where;
        return [
          {
            id: "correction-a",
            invoiceId: "invoice-a",
            status: "Executed",
            amount: new Prisma.Decimal("20.00"),
            requestedAt: new Date("2030-01-01T00:00:00.000Z"),
            executedAt: new Date("2030-01-02T04:15:00.000Z"),
            invoice: { invoiceNumber: "INV-00001" },
          },
        ];
      },
    },
  });
  const result = await service.reconciliation(
    { date: "2030-01-02", locationId: "location-a" },
    financeActor,
  );
  assert.equal(result.totals.correctedNpr, "20.00");
  assert.match(JSON.stringify(observedCorrectionWhere), /executedAt/);
  assert.doesNotMatch(JSON.stringify(observedInvoiceWheres), /Draft|Cancelled/);
  assert.match(JSON.stringify(observedInvoiceWheres), /PartiallyPaid/);
});
