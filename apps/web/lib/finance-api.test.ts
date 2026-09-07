import assert from "node:assert/strict";
import test from "node:test";

import { rememberCsrfToken } from "./api-client";
import {
  createFinanceInvoice,
  recordFinancePayment,
} from "./finance-api";

test("draft creation uses the protected v1 command and idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  rememberCsrfToken("test-csrf");
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), init };
    return Response.json({
      data: {
        invoice: { id: "invoice-1", invoiceNumber: "INV-1", status: "Draft" },
        replayed: false,
      },
      meta: { apiVersion: "v1" },
    });
  }) as typeof fetch;

  try {
    await createFinanceInvoice(
      {
        locationId: "location-1",
        clientId: "client-1",
        lineItems: [
          {
            description: "Consultation",
            quantity: 1,
            unitPriceNpr: "1000.00",
          },
        ],
      },
      "invoice-attempt-key-0001",
    );
    assert.equal(request?.url, "/api/v1/finance/invoices");
    assert.equal(
      new Headers(request?.init?.headers).get("Idempotency-Key"),
      "invoice-attempt-key-0001",
    );
    assert.equal(request?.init?.method, "POST");
  } finally {
    globalThis.fetch = originalFetch;
    rememberCsrfToken();
  }
});

test("payment recording sends received time and no optimistic status", async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> = {};
  let headers = new Headers();
  rememberCsrfToken("test-csrf");
  globalThis.fetch = (async (_input, init) => {
    headers = new Headers(init?.headers);
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      data: {
        payment: {
          id: "payment-1",
          invoiceId: "invoice-1",
          amountNpr: "500.00",
          status: "Completed",
          paidAtIso: "2026-07-27T10:00:00.000Z",
        },
        replayed: false,
      },
      meta: { apiVersion: "v1" },
    });
  }) as typeof fetch;

  try {
    await recordFinancePayment({
      invoiceId: "invoice-1",
      locationId: "location-1",
      amountNpr: "500.00",
      method: "MobileWallet",
      paidAtIso: "2026-07-27T10:00:00.000Z",
      referenceNumber: "FONEPAY-123",
      idempotencyKey: "payment-attempt-key-001",
    });
    assert.equal(headers.get("Idempotency-Key"), "payment-attempt-key-001");
    assert.equal(body.paidAtIso, "2026-07-27T10:00:00.000Z");
    assert.equal(body.referenceNumber, "FONEPAY-123");
    assert.equal("status" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
    rememberCsrfToken();
  }
});
