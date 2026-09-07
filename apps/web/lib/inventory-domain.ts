export type InventoryCapabilities = {
  canCreateCatalog: boolean;
  canOperateStock: boolean;
  canArchiveCatalog: boolean;
  canPurgeCatalog: boolean;
};

export type InventoryLocation = {
  id: string;
  name: string;
  timezone: string;
};

export type InventorySupplier = {
  id: string;
  code: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
};

export type InventoryBalance = {
  locationId: string;
  locationName: string;
  quantity: string;
  version: number;
  lastMovementAtIso?: string | null;
  isLowStock: boolean;
  isOutOfStock: boolean;
};

export type InventoryLot = {
  id: string;
  locationId: string;
  lotNumber: string;
  expiresAtIso?: string | null;
  status: "Available" | "Quarantined" | "Exhausted" | "Expired";
  quantity: string;
};

export type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  category?: string | null;
  description?: string | null;
  unit: string;
  trackLots: boolean;
  reorderPoint: string;
  preferredStock: string;
  preferredSupplier?: Pick<InventorySupplier, "id" | "code" | "name"> | null;
  archivedAtIso?: string | null;
  archiveReason?: string | null;
  balances: InventoryBalance[];
  totalQuantity: string;
  lowStockLocationCount: number;
  lots: InventoryLot[];
};

export type InventoryWorkspaceData = {
  capabilities: InventoryCapabilities;
  operationLocationIds: string[];
  locations: InventoryLocation[];
  suppliers: InventorySupplier[];
  summary: {
    activeItemCount: number;
    lowStockItemCount: number;
    outOfStockItemCount: number;
    expiringLotCount: number;
    movementCount: number;
  };
  items: InventoryItem[];
};

export type InventoryMovement = {
  id: string;
  item: { id: string; sku: string; name: string; unit: string };
  location: { id: string; name: string };
  lot?: {
    id: string;
    lotNumber: string;
    expiresAtIso?: string | null;
    status: InventoryLot["status"];
  } | null;
  supplier?: Pick<InventorySupplier, "id" | "code" | "name"> | null;
  type:
    | "OpeningBalance"
    | "Receive"
    | "Consume"
    | "AdjustIncrease"
    | "AdjustDecrease"
    | "TransferOut"
    | "TransferIn"
    | "ReturnToStock"
    | "Quarantine"
    | "ReleaseFromQuarantine"
    | "Waste"
    | "StocktakeReconciliation";
  quantityDelta: string;
  balanceBefore: string;
  balanceAfter: string;
  lotBalanceBefore?: string | null;
  lotBalanceAfter?: string | null;
  transferGroupId?: string | null;
  sourceReference?: string | null;
  reason: string;
  occurredAtIso: string;
  postedBy: { id: string; name: string };
};
