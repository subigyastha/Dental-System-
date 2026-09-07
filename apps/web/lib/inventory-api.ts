import { apiFetchJson } from "@/lib/api-client";
import type {
  InventoryMovement,
  InventoryWorkspaceData,
} from "@/lib/inventory-domain";

type V1Envelope<T> = {
  data: T;
  meta: { apiVersion: "v1"; requestId?: string };
};

function queryString(values: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) query.set(key, value);
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export function loadInventoryWorkspace(
  options: {
    locationId?: string;
    lifecycle?: "active" | "archived" | "all";
    query?: string;
    signal?: AbortSignal;
  } = {},
) {
  return apiFetchJson<V1Envelope<InventoryWorkspaceData>>(
    `/v1/inventory/workspace${queryString({
      locationId: options.locationId,
      lifecycle: options.lifecycle,
      query: options.query,
    })}`,
    { cache: "no-store", signal: options.signal },
  ).then((response) => response.data);
}

export function loadInventoryMovements(options: {
  locationId?: string;
  itemId?: string;
  signal?: AbortSignal;
}) {
  return apiFetchJson<V1Envelope<{ items: InventoryMovement[] }>>(
    `/v1/inventory/movements${queryString({
      locationId: options.locationId,
      itemId: options.itemId,
    })}`,
    { cache: "no-store", signal: options.signal },
  ).then((response) => response.data.items);
}

export function createInventoryItem(input: {
  sku: string;
  name: string;
  category?: string;
  description?: string;
  unit: string;
  trackLots: boolean;
  reorderPoint: string;
  preferredStock: string;
  preferredSupplierId?: string;
}) {
  return command("/v1/inventory/items", input);
}

export function updateInventoryItem(
  itemId: string,
  input: {
    name?: string;
    category?: string;
    description?: string;
    unit?: string;
    trackLots?: boolean;
    reorderPoint?: string;
    preferredStock?: string;
    preferredSupplierId?: string;
  },
) {
  return apiFetchJson(`/v1/inventory/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function createInventorySupplier(input: {
  code: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}) {
  return command("/v1/inventory/suppliers", input);
}

export function receiveInventoryStock(
  input: {
    itemId: string;
    locationId: string;
    quantity: string;
    supplierId?: string;
    lotNumber?: string;
    expiresAtIso?: string;
    sourceReference?: string;
    reason: string;
  },
  idempotencyKey: string,
) {
  return idempotentCommand("/v1/inventory/receive", input, idempotencyKey);
}

export function consumeInventoryStock(
  input: {
    itemId: string;
    locationId: string;
    quantity: string;
    lotId?: string;
    sourceReference?: string;
    reason: string;
  },
  idempotencyKey: string,
) {
  return idempotentCommand("/v1/inventory/consume", input, idempotencyKey);
}

export function adjustInventoryStock(
  input: {
    itemId: string;
    locationId: string;
    direction: "increase" | "decrease";
    quantity: string;
    lotId?: string;
    sourceReference?: string;
    reason: string;
  },
  idempotencyKey: string,
) {
  return idempotentCommand("/v1/inventory/adjustments", input, idempotencyKey);
}

export function recordInventoryStocktake(
  input: {
    itemId: string;
    locationId: string;
    countedQuantity: string;
    lotId?: string;
    countedAtIso?: string;
    reason: string;
  },
  idempotencyKey: string,
) {
  return idempotentCommand("/v1/inventory/stocktakes", input, idempotencyKey);
}

export function transferInventoryStock(
  input: {
    itemId: string;
    sourceLocationId: string;
    destinationLocationId: string;
    quantity: string;
    sourceLotId?: string;
    reason: string;
  },
  idempotencyKey: string,
) {
  return idempotentCommand("/v1/inventory/transfers", input, idempotencyKey);
}

export function archiveInventoryItem(itemId: string, reason: string) {
  return command(
    `/v1/inventory/items/${encodeURIComponent(itemId)}/archive`,
    { reason },
  );
}

export function restoreInventoryItem(itemId: string, reason: string) {
  return command(
    `/v1/inventory/items/${encodeURIComponent(itemId)}/restore`,
    { reason },
  );
}

export function purgeInventoryItem(itemId: string, confirmation: string) {
  return apiFetchJson(
    `/v1/inventory/items/${encodeURIComponent(itemId)}/purge`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation }),
    },
  );
}

function command(path: string, input: object) {
  return apiFetchJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

function idempotentCommand(path: string, input: object, idempotencyKey: string) {
  return apiFetchJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
}
