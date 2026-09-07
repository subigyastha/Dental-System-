import assert from "node:assert/strict";
import test from "node:test";

import { rememberCsrfToken } from "./api-client";
import {
  loadInventoryWorkspace,
  purgeInventoryItem,
  receiveInventoryStock,
  updateInventoryItem,
} from "./inventory-api";

test("Inventory receipt uses the dedicated protected command and stable idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  rememberCsrfToken("test-csrf");
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), init };
    return Response.json({ data: { movements: [], replayed: false }, meta: { apiVersion: "v1" } });
  }) as typeof fetch;
  try {
    await receiveInventoryStock(
      {
        itemId: "item-a",
        locationId: "location-a",
        quantity: "5",
        reason: "Supplier receipt",
      },
      "inventory-receipt-key-01",
    );
    assert.equal(request?.url, "/api/v1/inventory/receive");
    assert.equal(request?.init?.method, "POST");
    assert.equal(
      new Headers(request?.init?.headers).get("Idempotency-Key"),
      "inventory-receipt-key-01",
    );
    assert.ok(new Headers(request?.init?.headers).has("x-csrf-token"));
    assert.equal(request?.url.includes("finance"), false);
  } finally {
    globalThis.fetch = originalFetch;
    rememberCsrfToken();
  }
});

test("Inventory workspace sends bounded location, lifecycle, and search filters", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  globalThis.fetch = (async (input) => {
    url = String(input);
    return Response.json({
      data: {
        capabilities: {}, operationLocationIds: [], locations: [], suppliers: [],
        summary: {}, items: [],
      },
      meta: { apiVersion: "v1" },
    });
  }) as typeof fetch;
  try {
    await loadInventoryWorkspace({
      locationId: "location-a",
      lifecycle: "archived",
      query: "gloves",
    });
    assert.equal(
      url,
      "/api/v1/inventory/workspace?locationId=location-a&lifecycle=archived&query=gloves",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("permanent deletion is an explicit DELETE from archive with target confirmation", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  rememberCsrfToken("test-csrf");
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), init };
    return Response.json({ data: { deleted: true }, meta: { apiVersion: "v1" } });
  }) as typeof fetch;
  try {
    await purgeInventoryItem("item/a", "GLOVE-M");
    assert.equal(request?.url, "/api/v1/inventory/items/item%2Fa/purge");
    assert.equal(request?.init?.method, "DELETE");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), { confirmation: "GLOVE-M" });
  } finally {
    globalThis.fetch = originalFetch;
    rememberCsrfToken();
  }
});

test("Inventory catalog settings use a protected PATCH on the immutable item identity", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  rememberCsrfToken("test-csrf");
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), init };
    return Response.json({ data: { item: {} }, meta: { apiVersion: "v1" } });
  }) as typeof fetch;
  try {
    await updateInventoryItem("item/a", {
      name: "Examination gloves",
      reorderPoint: "8",
      preferredStock: "24",
      preferredSupplierId: "",
    });
    assert.equal(request?.url, "/api/v1/inventory/items/item%2Fa");
    assert.equal(request?.init?.method, "PATCH");
    assert.ok(new Headers(request?.init?.headers).has("x-csrf-token"));
    assert.equal(JSON.parse(String(request?.init?.body)).sku, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    rememberCsrfToken();
  }
});
