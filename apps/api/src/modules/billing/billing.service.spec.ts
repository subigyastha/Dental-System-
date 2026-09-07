import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "@nestjs/common";

import { BillingService } from "./billing.service";

const financeActor = {
  id: "finance-a",
  organizationId: "clinic-a",
  role: "Finance",
  effectiveRoles: ["Finance"],
};

test("issued invoices reject the generic edit path", async () => {
  const service = new BillingService(
    {
      invoice: {
        findFirst: async () => ({
          id: "invoice-a",
          organizationId: "clinic-a",
          status: "Issued",
          payments: [],
        }),
      },
    } as never,
    { requireSession: async () => financeActor } as never,
  );

  await assert.rejects(
    service.updateInvoice("invoice-a", {
      organizationId: "clinic-a",
      customerId: "client-a",
      lineItems: [],
      status: "Issued",
    }),
    (error) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(
        error.message,
        "Issued invoices cannot be edited; use a correction or void workflow",
      );
      return true;
    },
  );
});

test("completed payments reject the generic edit and delete paths", async () => {
  const service = new BillingService(
    {
      invoice: {
        findFirst: async () => ({ id: "invoice-a", organizationId: "clinic-a" }),
      },
      payment: {
        findFirst: async () => ({
          id: "payment-a",
          invoiceId: "invoice-a",
          organizationId: "clinic-a",
          status: "Completed",
        }),
      },
    } as never,
    { requireSession: async () => financeActor } as never,
  );

  await assert.rejects(
    service.updatePayment("invoice-a", "payment-a", {
      organizationId: "clinic-a",
      amount: 100,
      method: "Cash",
    }),
    (error) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(
        error.message,
        "Completed payments cannot be edited; record a refund or reversal instead",
      );
      return true;
    },
  );

  await assert.rejects(
    service.deletePayment("invoice-a", "payment-a"),
    (error) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(
        error.message,
        "Completed payments cannot be deleted; record a refund or reversal instead",
      );
      return true;
    },
  );
});

test("receptionists can record eligible payments but cannot issue an invoice", async () => {
  const service = new BillingService(
    {} as never,
    {
      requireSession: async () => ({
        ...financeActor,
        role: "Receptionist",
        effectiveRoles: ["Receptionist"],
      }),
    } as never,
  );

  await assert.rejects(
    service.issueInvoice("invoice-a", "clinic-a"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.constructor.name, "ForbiddenException");
      assert.match(error.message, /may record eligible payments/);
      return true;
    },
  );
});
