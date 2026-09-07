import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  InventoryMovementType,
  Prisma,
  type InventoryItem,
  type InventoryLot,
} from "@prisma/client";

import {
  AuthService,
  type AuthSession,
  type AuthSessionReference,
} from "../auth/auth.service";
import {
  effectiveRoleUnion,
  effectiveRoleUnionForLocation,
} from "../auth/authz";
import { PrismaService } from "../prisma/prisma.service";
import type {
  AdjustInventoryStockDto,
  ArchiveInventoryItemDto,
  ConsumeInventoryStockDto,
  CreateInventoryItemDto,
  CreateInventorySupplierDto,
  InventoryMovementQueryDto,
  InventoryStocktakeDto,
  InventoryWorkspaceQueryDto,
  PurgeInventoryItemDto,
  ReceiveInventoryStockDto,
  RestoreInventoryItemDto,
  TransferInventoryStockDto,
  UpdateInventoryItemDto,
} from "./dto/inventory.dto";

const READ_ROLES = new Set(["Owner", "Admin", "Manager", "InventoryManager"]);
const WRITE_ROLES = new Set(["Owner", "Admin", "InventoryManager"]);
const ARCHIVE_ROLES = new Set(["Owner", "Admin"]);
const PURGE_ROLES = new Set(["Owner"]);
const ZERO = new Prisma.Decimal(0);
// Inventory commands can make several serialized round trips to a remote Postgres
// database (command lock, balance lock, lot/balance/movement/audit writes). Prisma's
// five-second interactive-transaction default is too short for that bounded unit of
// work when the database is reached through a hosted pooler.
const INVENTORY_TRANSACTION_MAX_WAIT_MS = 10_000;
const INVENTORY_TRANSACTION_TIMEOUT_MS = 20_000;

const movementInclude = Prisma.validator<Prisma.InventoryMovementInclude>()({
  item: { select: { id: true, sku: true, name: true, unit: true } },
  location: { select: { id: true, name: true } },
  lot: { select: { id: true, lotNumber: true, expiresAt: true, status: true } },
  supplier: { select: { id: true, code: true, name: true } },
  postedBy: { select: { id: true, name: true } },
});

const stocktakeInclude = Prisma.validator<Prisma.InventoryStocktakeInclude>()({
  item: { select: { id: true, sku: true, name: true, unit: true } },
  location: { select: { id: true, name: true } },
  lot: { select: { id: true, lotNumber: true } },
  movement: { include: movementInclude },
  createdBy: { select: { id: true, name: true } },
});

type MovementWithDetails = Prisma.InventoryMovementGetPayload<{
  include: typeof movementInclude;
}>;

type StocktakeWithDetails = Prisma.InventoryStocktakeGetPayload<{
  include: typeof stocktakeInclude;
}>;

type InventoryScope = {
  roles: string[];
  locationWhere?: { equals?: string; in?: string[] };
};

type SingleMovementCommand = {
  itemId: string;
  locationId: string;
  type: InventoryMovementType;
  quantity: Prisma.Decimal;
  direction: 1 | -1;
  lotId?: string;
  lotNumber?: string;
  expiresAt?: Date;
  supplierId?: string;
  sourceReference?: string;
  reason: string;
  requestHash: string;
  idempotencyKey: string;
  receipt: boolean;
  blockUnavailableLot: boolean;
};

@Injectable()
export class InventoryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async workspace(
    query: InventoryWorkspaceQueryDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    const scope = this.inventoryScope(actor, query.locationId, READ_ROLES);
    if (query.locationId) {
      await this.assertLocation(this.prisma, actor.organizationId, query.locationId);
    }
    const locationFilter = scope.locationWhere
      ? { id: scope.locationWhere }
      : undefined;
    const lifecycle = query.lifecycle ?? "active";
    const archivedAt =
      lifecycle === "active" ? null : lifecycle === "archived" ? { not: null } : undefined;
    const search = query.query?.trim();

    const [locations, items, suppliers, movementCount] = await Promise.all([
      this.prisma.location.findMany({
        where: {
          organizationId: actor.organizationId,
          isActive: true,
          ...(locationFilter ?? {}),
        },
        select: { id: true, name: true, timezone: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      this.prisma.inventoryItem.findMany({
        where: {
          organizationId: actor.organizationId,
          ...(archivedAt !== undefined ? { archivedAt } : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { sku: { contains: search, mode: "insensitive" } },
                  { category: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        include: {
          preferredSupplier: { select: { id: true, code: true, name: true } },
          balances: {
            where: scope.locationWhere ? { locationId: scope.locationWhere } : undefined,
            select: {
              locationId: true,
              quantityOnHand: true,
              version: true,
              lastMovementAt: true,
            },
          },
          lots: {
            where: {
              quantityOnHand: { gt: ZERO },
              ...(scope.locationWhere ? { locationId: scope.locationWhere } : {}),
            },
            select: {
              id: true,
              locationId: true,
              lotNumber: true,
              expiresAt: true,
              status: true,
              quantityOnHand: true,
            },
            orderBy: [{ expiresAt: "asc" }, { lotNumber: "asc" }],
          },
        },
        orderBy: [{ archivedAt: "asc" }, { name: "asc" }, { sku: "asc" }],
        take: 250,
      }),
      this.prisma.inventorySupplier.findMany({
        where: { organizationId: actor.organizationId, archivedAt: null },
        select: { id: true, code: true, name: true, contactName: true, phone: true },
        orderBy: [{ name: "asc" }, { code: "asc" }],
        take: 250,
      }),
      this.prisma.inventoryMovement.count({
        where: {
          organizationId: actor.organizationId,
          ...(scope.locationWhere ? { locationId: scope.locationWhere } : {}),
        },
      }),
    ]);

    const now = Date.now();
    const expiryHorizon = now + 30 * 24 * 60 * 60 * 1000;
    const mappedItems = items.map((item) => {
      const balancesByLocation = new Map(
        item.balances.map((balance) => [balance.locationId, balance]),
      );
      const balances = locations.map((location) => {
        const balance = balancesByLocation.get(location.id);
        const quantity = balance?.quantityOnHand ?? ZERO;
        return {
          locationId: location.id,
          locationName: location.name,
          quantity: this.quantity(quantity),
          version: balance?.version ?? 0,
          lastMovementAtIso: balance?.lastMovementAt?.toISOString() ?? null,
          isLowStock: quantity.lessThanOrEqualTo(item.reorderPoint),
          isOutOfStock: quantity.isZero(),
        };
      });
      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category,
        description: item.description,
        unit: item.unit,
        trackLots: item.trackLots,
        reorderPoint: this.quantity(item.reorderPoint),
        preferredStock: this.quantity(item.preferredStock),
        preferredSupplier: item.preferredSupplier,
        archivedAtIso: item.archivedAt?.toISOString() ?? null,
        archiveReason: item.archiveReason,
        balances,
        totalQuantity: this.quantity(
          balances.reduce(
            (sum, balance) => sum.plus(balance.quantity),
            ZERO,
          ),
        ),
        lowStockLocationCount: balances.filter((balance) => balance.isLowStock).length,
        lots: item.lots.map((lot) => ({
          id: lot.id,
          locationId: lot.locationId,
          lotNumber: lot.lotNumber,
          expiresAtIso: lot.expiresAt?.toISOString() ?? null,
          status: lot.status,
          quantity: this.quantity(lot.quantityOnHand),
        })),
      };
    });

    return {
      capabilities: {
        canCreateCatalog: this.hasOrganizationRole(actor, WRITE_ROLES),
        canOperateStock: this.allowedLocationIds(actor, WRITE_ROLES) !== undefined,
        canArchiveCatalog: this.hasOrganizationRole(actor, ARCHIVE_ROLES),
        canPurgeCatalog: this.hasOrganizationRole(actor, PURGE_ROLES),
      },
      operationLocationIds: this.materializedLocationIds(
        actor,
        WRITE_ROLES,
        locations.map((location) => location.id),
      ),
      locations,
      suppliers,
      summary: {
        activeItemCount: mappedItems.filter((item) => !item.archivedAtIso).length,
        lowStockItemCount: mappedItems.filter(
          (item) => !item.archivedAtIso && item.lowStockLocationCount > 0,
        ).length,
        outOfStockItemCount: mappedItems.filter(
          (item) =>
            !item.archivedAtIso && item.balances.some((balance) => balance.isOutOfStock),
        ).length,
        expiringLotCount: mappedItems
          .flatMap((item) => item.lots)
          .filter((lot) => {
            if (!lot.expiresAtIso) return false;
            const expiresAt = new Date(lot.expiresAtIso).getTime();
            return expiresAt >= now && expiresAt <= expiryHorizon;
          }).length,
        movementCount,
      },
      items: mappedItems,
    };
  }

  async movementHistory(
    query: InventoryMovementQueryDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    const scope = this.inventoryScope(actor, query.locationId, READ_ROLES);
    if (query.locationId) {
      await this.assertLocation(this.prisma, actor.organizationId, query.locationId);
    }
    const movements = await this.prisma.inventoryMovement.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(scope.locationWhere ? { locationId: scope.locationWhere } : {}),
        ...(query.itemId ? { itemId: query.itemId } : {}),
      },
      include: movementInclude,
      orderBy: [{ occurredAt: "desc" }, { sequence: "asc" }, { id: "desc" }],
      take: 150,
    });
    return { items: movements.map((movement) => this.mapMovement(movement)) };
  }

  async createItem(
    dto: CreateInventoryItemDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireOrganizationRole(actor, WRITE_ROLES, "create Inventory catalog items");
    const reorderPoint = this.nonnegativeQuantity(dto.reorderPoint);
    const preferredStock = this.nonnegativeQuantity(dto.preferredStock);
    if (preferredStock.isPositive() && preferredStock.lessThan(reorderPoint)) {
      throw new BadRequestException("Preferred stock must be zero or at least the reorder point");
    }
    if (dto.preferredSupplierId) {
      await this.assertSupplier(
        this.prisma,
        actor.organizationId,
        dto.preferredSupplierId,
      );
    }
    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const created = await tx.inventoryItem.create({
          data: {
            organizationId: actor.organizationId,
            sku: dto.sku.trim().toUpperCase(),
            name: dto.name.trim(),
            category: dto.category?.trim() || null,
            description: dto.description?.trim() || null,
            unit: dto.unit.trim(),
            trackLots: dto.trackLots,
            reorderPoint,
            preferredStock,
            preferredSupplierId: dto.preferredSupplierId || null,
            createdByUserId: actor.id,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            actorId: actor.id,
            entityType: "inventory_item",
            entityId: created.id,
            action: "created",
            newValue: {
              sku: created.sku,
              name: created.name,
              unit: created.unit,
              trackLots: created.trackLots,
            },
            description: "Inventory catalog item created",
          },
        });
        return created;
      });
      return { item: this.mapItemCommand(item) };
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw this.conflict("INVENTORY_SKU_EXISTS", "This Inventory SKU is already in use.");
      }
      throw error;
    }
  }

  async createSupplier(
    dto: CreateInventorySupplierDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireOrganizationRole(actor, WRITE_ROLES, "create Inventory suppliers");
    try {
      const supplier = await this.prisma.$transaction(async (tx) => {
        const created = await tx.inventorySupplier.create({
          data: {
            organizationId: actor.organizationId,
            code: dto.code.trim().toUpperCase(),
            name: dto.name.trim(),
            contactName: dto.contactName?.trim() || null,
            phone: dto.phone?.trim() || null,
            email: dto.email?.trim().toLowerCase() || null,
            address: dto.address?.trim() || null,
            notes: dto.notes?.trim() || null,
            createdByUserId: actor.id,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            actorId: actor.id,
            entityType: "inventory_supplier",
            entityId: created.id,
            action: "created",
            newValue: { code: created.code, name: created.name },
            description: "Inventory supplier created",
          },
        });
        return created;
      });
      return {
        supplier: { id: supplier.id, code: supplier.code, name: supplier.name },
      };
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw this.conflict(
          "INVENTORY_SUPPLIER_CODE_EXISTS",
          "This supplier code is already in use.",
        );
      }
      throw error;
    }
  }

  async updateItem(
    id: string,
    dto: UpdateInventoryItemDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireOrganizationRole(actor, WRITE_ROLES, "update Inventory catalog items");
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, organizationId: actor.organizationId, archivedAt: null },
    });
    if (!item) throw new NotFoundException("Active Inventory item not found");
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException("Provide at least one Inventory item change");
    }

    const reorderPoint = dto.reorderPoint === undefined
      ? item.reorderPoint
      : this.nonnegativeQuantity(dto.reorderPoint);
    const preferredStock = dto.preferredStock === undefined
      ? item.preferredStock
      : this.nonnegativeQuantity(dto.preferredStock);
    if (preferredStock.isPositive() && preferredStock.lessThan(reorderPoint)) {
      throw new BadRequestException("Preferred stock must be zero or at least the reorder point");
    }
    const preferredSupplierId = dto.preferredSupplierId === undefined
      ? item.preferredSupplierId
      : dto.preferredSupplierId.trim() || null;
    if (preferredSupplierId) {
      await this.assertSupplier(this.prisma, actor.organizationId, preferredSupplierId);
    }
    if (dto.trackLots !== undefined && dto.trackLots !== item.trackLots) {
      const movementCount = await this.prisma.inventoryMovement.count({
        where: { organizationId: actor.organizationId, itemId: id },
      });
      if (movementCount) {
        throw this.conflict(
          "INVENTORY_LOT_POLICY_LOCKED",
          "Lot tracking cannot change after stock history exists. Archive this item and create a replacement if the policy must change.",
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.inventoryItem.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.category !== undefined ? { category: dto.category.trim() || null } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
          ...(dto.unit !== undefined ? { unit: dto.unit.trim() } : {}),
          ...(dto.trackLots !== undefined ? { trackLots: dto.trackLots } : {}),
          reorderPoint,
          preferredStock,
          preferredSupplierId,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "inventory_item",
          entityId: id,
          action: "updated",
          oldValue: {
            name: item.name,
            category: item.category,
            description: item.description,
            unit: item.unit,
            trackLots: item.trackLots,
            reorderPoint: this.quantity(item.reorderPoint),
            preferredStock: this.quantity(item.preferredStock),
            preferredSupplierId: item.preferredSupplierId,
          },
          newValue: {
            name: result.name,
            category: result.category,
            description: result.description,
            unit: result.unit,
            trackLots: result.trackLots,
            reorderPoint: this.quantity(result.reorderPoint),
            preferredStock: this.quantity(result.preferredStock),
            preferredSupplierId: result.preferredSupplierId,
          },
          description: "Inventory catalog item updated",
        },
      });
      return result;
    });
    return { item: this.mapItemCommand(updated) };
  }

  async receive(
    dto: ReceiveInventoryStockDto,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireLocationRole(actor, dto.locationId, WRITE_ROLES, "receive stock");
    const quantity = this.positiveQuantity(dto.quantity);
    const expiresAt = dto.expiresAtIso ? new Date(dto.expiresAtIso) : undefined;
    const requestHash = this.hash({
      command: "receive",
      ...dto,
      quantity: this.quantity(quantity),
      expiresAtIso: expiresAt?.toISOString() ?? null,
    });
    return this.postSingleMovement(actor, {
      itemId: dto.itemId,
      locationId: dto.locationId,
      type: InventoryMovementType.Receive,
      quantity,
      direction: 1,
      lotNumber: dto.lotNumber?.trim(),
      expiresAt,
      supplierId: dto.supplierId,
      sourceReference: dto.sourceReference?.trim(),
      reason: dto.reason.trim(),
      requestHash,
      idempotencyKey,
      receipt: true,
      blockUnavailableLot: false,
    });
  }

  async adjust(
    dto: AdjustInventoryStockDto,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireLocationRole(actor, dto.locationId, WRITE_ROLES, "adjust stock");
    const quantity = this.positiveQuantity(dto.quantity);
    const requestHash = this.hash({
      command: "adjust",
      ...dto,
      quantity: this.quantity(quantity),
    });
    return this.postSingleMovement(actor, {
      itemId: dto.itemId,
      locationId: dto.locationId,
      type:
        dto.direction === "increase"
          ? InventoryMovementType.AdjustIncrease
          : InventoryMovementType.AdjustDecrease,
      quantity,
      direction: dto.direction === "increase" ? 1 : -1,
      lotId: dto.lotId,
      sourceReference: dto.sourceReference?.trim(),
      reason: dto.reason.trim(),
      requestHash,
      idempotencyKey,
      receipt: false,
      blockUnavailableLot: false,
    });
  }

  async consume(
    dto: ConsumeInventoryStockDto,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireLocationRole(actor, dto.locationId, WRITE_ROLES, "record stock usage");
    const quantity = this.positiveQuantity(dto.quantity);
    const requestHash = this.hash({
      command: "consume",
      ...dto,
      quantity: this.quantity(quantity),
    });
    return this.postSingleMovement(actor, {
      itemId: dto.itemId,
      locationId: dto.locationId,
      type: InventoryMovementType.Consume,
      quantity,
      direction: -1,
      lotId: dto.lotId,
      sourceReference: dto.sourceReference?.trim(),
      reason: dto.reason.trim(),
      requestHash,
      idempotencyKey,
      receipt: false,
      blockUnavailableLot: true,
    });
  }

  async transfer(
    dto: TransferInventoryStockDto,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    if (dto.sourceLocationId === dto.destinationLocationId) {
      throw new BadRequestException("Source and destination locations must be different");
    }
    this.requireLocationRole(actor, dto.sourceLocationId, WRITE_ROLES, "transfer stock");
    this.requireLocationRole(
      actor,
      dto.destinationLocationId,
      WRITE_ROLES,
      "transfer stock",
    );
    const quantity = this.positiveQuantity(dto.quantity);
    const requestHash = this.hash({
      command: "transfer",
      ...dto,
      quantity: this.quantity(quantity),
    });
    const replay = await this.findMovementReplay(actor, idempotencyKey);
    if (replay.length) {
      this.assertReplay(replay[0].requestHash, requestHash);
      return { movements: replay.map((item) => this.mapMovement(item)), replayed: true };
    }

    const movements = await this.serializable(async (tx) => {
      await this.lockCommand(tx, actor, idempotencyKey);
      const insideReplay = await this.findMovementReplayTx(tx, actor, idempotencyKey);
      if (insideReplay.length) {
        this.assertReplay(insideReplay[0].requestHash, requestHash);
        return insideReplay;
      }
      const lockKeys = [dto.sourceLocationId, dto.destinationLocationId].sort();
      for (const locationId of lockKeys) {
        await this.lockBalance(tx, actor.organizationId, dto.itemId, locationId);
      }
      const [item, sourceLocation, destinationLocation] = await Promise.all([
        this.requireActiveItem(tx, actor.organizationId, dto.itemId),
        this.assertLocation(tx, actor.organizationId, dto.sourceLocationId),
        this.assertLocation(tx, actor.organizationId, dto.destinationLocationId),
      ]);
      const sourceLot = await this.resolveExistingLot(
        tx,
        actor.organizationId,
        item,
        dto.sourceLocationId,
        dto.sourceLotId,
        true,
      );
      const transferGroupId = randomUUID();
      const occurredAt = new Date();
      const outgoing = await this.writeMovement(tx, actor, {
        item,
        locationId: sourceLocation.id,
        lot: sourceLot,
        type: InventoryMovementType.TransferOut,
        delta: quantity.negated(),
        reason: dto.reason.trim(),
        occurredAt,
        transferGroupId,
        requestHash,
        idempotencyKey,
        sequence: 0,
      });
      const destinationLot = await this.resolveTransferDestinationLot(
        tx,
        actor.organizationId,
        item,
        destinationLocation.id,
        sourceLot,
        occurredAt,
      );
      const incoming = await this.writeMovement(tx, actor, {
        item,
        locationId: destinationLocation.id,
        lot: destinationLot,
        supplierId: sourceLot?.supplierId ?? undefined,
        type: InventoryMovementType.TransferIn,
        delta: quantity,
        reason: dto.reason.trim(),
        occurredAt,
        transferGroupId,
        requestHash,
        idempotencyKey,
        sequence: 1,
      });
      return [outgoing, incoming];
    });
    return { movements: movements.map((item) => this.mapMovement(item)), replayed: false };
  }

  async stocktake(
    dto: InventoryStocktakeDto,
    idempotencyKey: string,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireLocationRole(actor, dto.locationId, WRITE_ROLES, "record a stocktake");
    const countedQuantity = this.nonnegativeQuantity(dto.countedQuantity);
    const countedAt = dto.countedAtIso ? new Date(dto.countedAtIso) : new Date();
    const requestHash = this.hash({
      command: "stocktake",
      ...dto,
      countedQuantity: this.quantity(countedQuantity),
      countedAtIso: countedAt.toISOString(),
    });
    const replay = await this.prisma.inventoryStocktake.findUnique({
      where: {
        organizationId_createdByUserId_idempotencyKey: {
          organizationId: actor.organizationId,
          createdByUserId: actor.id,
          idempotencyKey,
        },
      },
      include: stocktakeInclude,
    });
    if (replay) {
      this.assertReplay(replay.requestHash, requestHash);
      return { stocktake: this.mapStocktake(replay), replayed: true };
    }

    const result = await this.serializable(async (tx) => {
      await this.lockCommand(tx, actor, idempotencyKey);
      const insideReplay = await tx.inventoryStocktake.findUnique({
        where: {
          organizationId_createdByUserId_idempotencyKey: {
            organizationId: actor.organizationId,
            createdByUserId: actor.id,
            idempotencyKey,
          },
        },
        include: stocktakeInclude,
      });
      if (insideReplay) {
        this.assertReplay(insideReplay.requestHash, requestHash);
        return insideReplay;
      }
      await this.lockBalance(tx, actor.organizationId, dto.itemId, dto.locationId);
      const [item] = await Promise.all([
        this.requireActiveItem(tx, actor.organizationId, dto.itemId),
        this.assertLocation(tx, actor.organizationId, dto.locationId),
      ]);
      const lot = await this.resolveExistingLot(
        tx,
        actor.organizationId,
        item,
        dto.locationId,
        dto.lotId,
        false,
      );
      const balance = await tx.inventoryStockBalance.findUnique({
        where: {
          organizationId_itemId_locationId: {
            organizationId: actor.organizationId,
            itemId: dto.itemId,
            locationId: dto.locationId,
          },
        },
      });
      const systemQuantity = lot?.quantityOnHand ?? balance?.quantityOnHand ?? ZERO;
      const variance = countedQuantity.minus(systemQuantity);
      const movement = variance.isZero()
        ? null
        : await this.writeMovement(tx, actor, {
            item,
            locationId: dto.locationId,
            lot,
            type: InventoryMovementType.StocktakeReconciliation,
            delta: variance,
            reason: dto.reason.trim(),
            occurredAt: countedAt,
            requestHash,
            idempotencyKey,
            sequence: 0,
          });
      const stocktake = await tx.inventoryStocktake.create({
        data: {
          organizationId: actor.organizationId,
          itemId: dto.itemId,
          locationId: dto.locationId,
          lotId: lot?.id ?? null,
          systemQuantity,
          countedQuantity,
          varianceQuantity: variance,
          reason: dto.reason.trim(),
          countedAt,
          movementId: movement?.id ?? null,
          createdByUserId: actor.id,
          idempotencyKey,
          requestHash,
        },
        include: stocktakeInclude,
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "inventory_stocktake",
          entityId: stocktake.id,
          action: "posted",
          oldValue: { systemQuantity: this.quantity(systemQuantity) },
          newValue: {
            countedQuantity: this.quantity(countedQuantity),
            varianceQuantity: this.quantity(variance),
            movementId: movement?.id ?? null,
          },
          description: "Inventory stocktake posted",
        },
      });
      return stocktake;
    });
    return { stocktake: this.mapStocktake(result), replayed: false };
  }

  async archiveItem(
    id: string,
    dto: ArchiveInventoryItemDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireOrganizationRole(actor, ARCHIVE_ROLES, "archive Inventory items");
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, organizationId: actor.organizationId, archivedAt: null },
    });
    if (!item) throw new NotFoundException("Inventory item not found");
    const aggregate = await this.prisma.inventoryStockBalance.aggregate({
      where: { organizationId: actor.organizationId, itemId: id },
      _sum: { quantityOnHand: true },
    });
    if ((aggregate._sum.quantityOnHand ?? ZERO).isPositive()) {
      throw this.conflict(
        "INVENTORY_ITEM_HAS_STOCK",
        "Move, consume, or reconcile remaining stock before archiving this item.",
      );
    }
    const archived = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: {
          archivedAt: new Date(),
          archivedByUserId: actor.id,
          archiveReason: dto.reason.trim(),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "inventory_item",
          entityId: id,
          action: "archived",
          oldValue: { archivedAt: null },
          newValue: { archivedAt: updated.archivedAt, reason: updated.archiveReason },
          description: "Inventory item archived",
        },
      });
      return updated;
    });
    return { item: this.mapItemCommand(archived) };
  }

  async restoreItem(
    id: string,
    dto: RestoreInventoryItemDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireOrganizationRole(actor, ARCHIVE_ROLES, "restore Inventory items");
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, organizationId: actor.organizationId, archivedAt: { not: null } },
    });
    if (!item) throw new NotFoundException("Archived Inventory item not found");
    const restored = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: { archivedAt: null, archivedByUserId: null, archiveReason: null },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "inventory_item",
          entityId: id,
          action: "restored",
          oldValue: { archivedAt: item.archivedAt, archiveReason: item.archiveReason },
          newValue: { archivedAt: null, restoreReason: dto.reason.trim() },
          description: "Inventory item restored",
        },
      });
      return updated;
    });
    return { item: this.mapItemCommand(restored) };
  }

  async purgeItem(
    id: string,
    dto: PurgeInventoryItemDto,
    authorization?: AuthSessionReference,
  ) {
    const actor = await this.auth.requireSession(authorization);
    this.requireOrganizationRole(actor, PURGE_ROLES, "permanently delete Inventory items");
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, organizationId: actor.organizationId, archivedAt: { not: null } },
    });
    if (!item) throw new NotFoundException("Archived Inventory item not found");
    if (dto.confirmation.trim().toUpperCase() !== item.sku.toUpperCase()) {
      throw new BadRequestException("Type the exact archived SKU to confirm permanent deletion");
    }
    const [movementCount, stocktakeCount, lotCount, balanceCount] = await Promise.all([
      this.prisma.inventoryMovement.count({ where: { organizationId: actor.organizationId, itemId: id } }),
      this.prisma.inventoryStocktake.count({ where: { organizationId: actor.organizationId, itemId: id } }),
      this.prisma.inventoryLot.count({ where: { organizationId: actor.organizationId, itemId: id } }),
      this.prisma.inventoryStockBalance.count({ where: { organizationId: actor.organizationId, itemId: id } }),
    ]);
    if (movementCount || stocktakeCount || lotCount || balanceCount) {
      throw this.conflict(
        "INVENTORY_RETENTION_REQUIRED",
        "This item has stock history and must remain archived for audit retention.",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.inventoryItem.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.id,
          entityType: "inventory_item",
          entityId: id,
          action: "permanently_deleted",
          oldValue: { sku: item.sku, name: item.name, archivedAt: item.archivedAt },
          description: "Unused archived Inventory item permanently deleted after Owner confirmation",
        },
      });
    });
    return { deleted: true, itemId: id };
  }

  private async postSingleMovement(actor: AuthSession, command: SingleMovementCommand) {
    const replay = await this.findMovementReplay(actor, command.idempotencyKey);
    if (replay.length) {
      this.assertReplay(replay[0].requestHash, command.requestHash);
      return { movements: replay.map((item) => this.mapMovement(item)), replayed: true };
    }
    const movements = await this.serializable(async (tx) => {
      await this.lockCommand(tx, actor, command.idempotencyKey);
      const insideReplay = await this.findMovementReplayTx(
        tx,
        actor,
        command.idempotencyKey,
      );
      if (insideReplay.length) {
        this.assertReplay(insideReplay[0].requestHash, command.requestHash);
        return insideReplay;
      }
      await this.lockBalance(tx, actor.organizationId, command.itemId, command.locationId);
      const [item] = await Promise.all([
        this.requireActiveItem(tx, actor.organizationId, command.itemId),
        this.assertLocation(tx, actor.organizationId, command.locationId),
      ]);
      if (command.supplierId) {
        await this.assertSupplier(tx, actor.organizationId, command.supplierId);
      }
      const occurredAt = new Date();
      const lot = command.receipt
        ? await this.resolveReceiptLot(tx, actor.organizationId, item, command, occurredAt)
        : await this.resolveExistingLot(
            tx,
            actor.organizationId,
            item,
            command.locationId,
            command.lotId,
            command.blockUnavailableLot,
          );
      const movement = await this.writeMovement(tx, actor, {
        item,
        locationId: command.locationId,
        lot,
        supplierId: command.supplierId,
        type: command.type,
        delta: command.direction === 1 ? command.quantity : command.quantity.negated(),
        sourceReference: command.sourceReference,
        reason: command.reason,
        occurredAt,
        requestHash: command.requestHash,
        idempotencyKey: command.idempotencyKey,
        sequence: 0,
      });
      return [movement];
    });
    return { movements: movements.map((item) => this.mapMovement(item)), replayed: false };
  }

  private async writeMovement(
    tx: Prisma.TransactionClient,
    actor: AuthSession,
    input: {
      item: InventoryItem;
      locationId: string;
      lot: InventoryLot | null;
      supplierId?: string;
      type: InventoryMovementType;
      delta: Prisma.Decimal;
      sourceReference?: string;
      reason: string;
      occurredAt: Date;
      transferGroupId?: string;
      requestHash: string;
      idempotencyKey: string;
      sequence: number;
    },
  ): Promise<MovementWithDetails> {
    const balance = await tx.inventoryStockBalance.findUnique({
      where: {
        organizationId_itemId_locationId: {
          organizationId: actor.organizationId,
          itemId: input.item.id,
          locationId: input.locationId,
        },
      },
    });
    const balanceBefore = balance?.quantityOnHand ?? ZERO;
    const balanceAfter = balanceBefore.plus(input.delta);
    if (balanceAfter.isNegative()) {
      throw this.conflict(
        "INVENTORY_NEGATIVE_STOCK",
        "This movement would make stock negative. Refresh the balance and try again.",
      );
    }

    const lotBefore = input.lot?.quantityOnHand ?? null;
    const lotAfter = lotBefore ? lotBefore.plus(input.delta) : null;
    if (lotAfter?.isNegative()) {
      throw this.conflict(
        "INVENTORY_NEGATIVE_LOT_STOCK",
        "This movement exceeds the selected lot balance.",
      );
    }
    if (input.item.trackLots && !input.lot) {
      throw new BadRequestException("This item requires a lot for every stock movement");
    }

    if (balance) {
      await tx.inventoryStockBalance.update({
        where: { id: balance.id },
        data: {
          quantityOnHand: balanceAfter,
          version: { increment: 1 },
          lastMovementAt: input.occurredAt,
        },
      });
    } else {
      await tx.inventoryStockBalance.create({
        data: {
          organizationId: actor.organizationId,
          itemId: input.item.id,
          locationId: input.locationId,
          quantityOnHand: balanceAfter,
          lastMovementAt: input.occurredAt,
        },
      });
    }
    if (input.lot && lotAfter) {
      const expired = Boolean(
        input.lot.expiresAt && input.lot.expiresAt.getTime() <= input.occurredAt.getTime(),
      );
      await tx.inventoryLot.update({
        where: { id: input.lot.id },
        data: {
          quantityOnHand: lotAfter,
          version: { increment: 1 },
          status: expired ? "Expired" : lotAfter.isZero() ? "Exhausted" : "Available",
        },
      });
    }
    const movement = await tx.inventoryMovement.create({
      data: {
        organizationId: actor.organizationId,
        itemId: input.item.id,
        locationId: input.locationId,
        lotId: input.lot?.id ?? null,
        supplierId: input.supplierId ?? input.lot?.supplierId ?? null,
        type: input.type,
        quantityDelta: input.delta,
        balanceBefore,
        balanceAfter,
        lotBalanceBefore: lotBefore,
        lotBalanceAfter: lotAfter,
        transferGroupId: input.transferGroupId ?? null,
        sourceReference: input.sourceReference ?? null,
        reason: input.reason,
        occurredAt: input.occurredAt,
        postedByUserId: actor.id,
        idempotencyKey: input.idempotencyKey,
        sequence: input.sequence,
        requestHash: input.requestHash,
      },
      include: movementInclude,
    });
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.id,
        entityType: "inventory_movement",
        entityId: movement.id,
        action: "posted",
        oldValue: {
          itemId: input.item.id,
          locationId: input.locationId,
          balance: this.quantity(balanceBefore),
        },
        newValue: {
          type: input.type,
          quantityDelta: this.quantity(input.delta),
          balance: this.quantity(balanceAfter),
          lotId: input.lot?.id ?? null,
          transferGroupId: input.transferGroupId ?? null,
        },
        description: "Immutable Inventory movement posted",
      },
    });
    return movement;
  }

  private async resolveReceiptLot(
    tx: Prisma.TransactionClient,
    organizationId: string,
    item: InventoryItem,
    command: SingleMovementCommand,
    occurredAt: Date,
  ) {
    if (!item.trackLots) {
      if (command.lotNumber || command.expiresAt) {
        throw new BadRequestException("Lot details are not enabled for this item");
      }
      return null;
    }
    const lotNumber = command.lotNumber?.trim();
    if (!lotNumber) {
      throw new BadRequestException("A lot number is required for this item");
    }
    if (command.expiresAt && command.expiresAt.getTime() <= occurredAt.getTime()) {
      throw this.conflict(
        "INVENTORY_LOT_EXPIRED",
        "Expired stock cannot be received as available Inventory.",
      );
    }
    const existing = await tx.inventoryLot.findUnique({
      where: {
        organizationId_itemId_locationId_lotNumber: {
          organizationId,
          itemId: item.id,
          locationId: command.locationId,
          lotNumber,
        },
      },
    });
    if (existing) {
      if (
        (existing.expiresAt?.toISOString() ?? null) !==
          (command.expiresAt?.toISOString() ?? null) ||
        (existing.supplierId ?? null) !== (command.supplierId ?? null)
      ) {
        throw this.conflict(
          "INVENTORY_LOT_DETAILS_MISMATCH",
          "This lot already exists with different supplier or expiry details.",
        );
      }
      if (existing.status === "Quarantined") {
        throw this.conflict(
          "INVENTORY_LOT_QUARANTINED",
          "Quarantined stock cannot receive an available balance movement.",
        );
      }
      return existing;
    }
    return tx.inventoryLot.create({
      data: {
        organizationId,
        itemId: item.id,
        locationId: command.locationId,
        supplierId: command.supplierId ?? null,
        lotNumber,
        receivedAt: occurredAt,
        expiresAt: command.expiresAt ?? null,
        quantityOnHand: ZERO,
      },
    });
  }

  private async resolveExistingLot(
    tx: Prisma.TransactionClient,
    organizationId: string,
    item: InventoryItem,
    locationId: string,
    lotId: string | undefined,
    blockUnavailable: boolean,
  ) {
    if (!item.trackLots) {
      if (lotId) throw new BadRequestException("Lot details are not enabled for this item");
      return null;
    }
    if (!lotId) throw new BadRequestException("Select a lot for this tracked item");
    const lot = await tx.inventoryLot.findFirst({
      where: { id: lotId, organizationId, itemId: item.id, locationId },
    });
    if (!lot) throw new NotFoundException("Inventory lot not found");
    if (
      blockUnavailable &&
      (lot.status !== "Available" ||
        Boolean(lot.expiresAt && lot.expiresAt.getTime() <= Date.now()))
    ) {
      throw this.conflict(
        "INVENTORY_LOT_UNAVAILABLE",
        "Expired, exhausted, or quarantined stock cannot be used or transferred.",
      );
    }
    return lot;
  }

  private async resolveTransferDestinationLot(
    tx: Prisma.TransactionClient,
    organizationId: string,
    item: InventoryItem,
    destinationLocationId: string,
    sourceLot: InventoryLot | null,
    occurredAt: Date,
  ) {
    if (!item.trackLots) return null;
    if (!sourceLot) throw new BadRequestException("Select a source lot for this transfer");
    const existing = await tx.inventoryLot.findUnique({
      where: {
        organizationId_itemId_locationId_lotNumber: {
          organizationId,
          itemId: item.id,
          locationId: destinationLocationId,
          lotNumber: sourceLot.lotNumber,
        },
      },
    });
    if (existing) {
      if (
        (existing.expiresAt?.toISOString() ?? null) !==
          (sourceLot.expiresAt?.toISOString() ?? null) ||
        (existing.supplierId ?? null) !== (sourceLot.supplierId ?? null)
      ) {
        throw this.conflict(
          "INVENTORY_DESTINATION_LOT_MISMATCH",
          "The destination has the same lot number with different traceability details.",
        );
      }
      return existing;
    }
    return tx.inventoryLot.create({
      data: {
        organizationId,
        itemId: item.id,
        locationId: destinationLocationId,
        supplierId: sourceLot.supplierId,
        lotNumber: sourceLot.lotNumber,
        receivedAt: occurredAt,
        expiresAt: sourceLot.expiresAt,
        quantityOnHand: ZERO,
      },
    });
  }

  private async requireActiveItem(
    tx: Prisma.TransactionClient,
    organizationId: string,
    itemId: string,
  ) {
    const item = await tx.inventoryItem.findFirst({
      where: { id: itemId, organizationId, archivedAt: null },
    });
    if (!item) {
      throw this.conflict(
        "INVENTORY_ITEM_UNAVAILABLE",
        "This Inventory item is archived or unavailable.",
      );
    }
    return item;
  }

  private async assertLocation(
    db: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    locationId: string,
  ) {
    const location = await db.location.findFirst({
      where: { id: locationId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!location) throw new NotFoundException("Inventory location not found");
    return location;
  }

  private async assertSupplier(
    db: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    supplierId: string,
  ) {
    const supplier = await db.inventorySupplier.findFirst({
      where: { id: supplierId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException("Inventory supplier not found");
    return supplier;
  }

  private async findMovementReplay(actor: AuthSession, idempotencyKey: string) {
    return this.prisma.inventoryMovement.findMany({
      where: {
        organizationId: actor.organizationId,
        postedByUserId: actor.id,
        idempotencyKey,
      },
      include: movementInclude,
      orderBy: [{ sequence: "asc" }],
    });
  }

  private async findMovementReplayTx(
    tx: Prisma.TransactionClient,
    actor: AuthSession,
    idempotencyKey: string,
  ) {
    return tx.inventoryMovement.findMany({
      where: {
        organizationId: actor.organizationId,
        postedByUserId: actor.id,
        idempotencyKey,
      },
      include: movementInclude,
      orderBy: [{ sequence: "asc" }],
    });
  }

  private inventoryScope(
    actor: AuthSession,
    locationId: string | undefined,
    roles: ReadonlySet<string>,
  ): InventoryScope {
    if (locationId) {
      const scopedRoles = effectiveRoleUnionForLocation(actor, locationId);
      if (!scopedRoles.some((role) => roles.has(role))) {
        throw new ForbiddenException("Inventory access is not allowed at this location");
      }
      return { roles: [...scopedRoles], locationWhere: { equals: locationId } };
    }
    if (!actor.effectiveRoleScopes) {
      const union = effectiveRoleUnion(actor);
      if (!union.some((role) => roles.has(role))) {
        throw new ForbiddenException("Inventory access is not allowed");
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
      throw new ForbiddenException("Inventory access is not allowed");
    }
    return {
      roles: [...new Set(scoped.map((scope) => scope.role))],
      locationWhere: { in: [...new Set(scoped.map((scope) => scope.locationId!))] },
    };
  }

  private rolesAt(actor: AuthSession, locationId: string | null) {
    if (locationId) return effectiveRoleUnionForLocation(actor, locationId);
    if (!actor.effectiveRoleScopes) return effectiveRoleUnion(actor);
    return actor.effectiveRoleScopes
      .filter((scope) => scope.locationId === null)
      .map((scope) => scope.role);
  }

  private requireLocationRole(
    actor: AuthSession,
    locationId: string,
    roles: ReadonlySet<string>,
    action: string,
  ) {
    if (!this.rolesAt(actor, locationId).some((role) => roles.has(role))) {
      throw new ForbiddenException(`You are not allowed to ${action} at this location`);
    }
  }

  private requireOrganizationRole(
    actor: AuthSession,
    roles: ReadonlySet<string>,
    action: string,
  ) {
    if (!this.hasOrganizationRole(actor, roles)) {
      throw new ForbiddenException(`You are not allowed to ${action}`);
    }
  }

  private hasOrganizationRole(actor: AuthSession, roles: ReadonlySet<string>) {
    return this.rolesAt(actor, null).some((role) => roles.has(role));
  }

  /** Returns null for organization-wide access, [] for no access, or scoped IDs. */
  private allowedLocationIds(
    actor: AuthSession,
    roles: ReadonlySet<string>,
  ): string[] | null | undefined {
    if (!actor.effectiveRoleScopes) {
      return effectiveRoleUnion(actor).some((role) => roles.has(role)) ? null : undefined;
    }
    if (
      actor.effectiveRoleScopes.some(
        (scope) => scope.locationId === null && roles.has(scope.role),
      )
    ) {
      return null;
    }
    const ids = [
      ...new Set(
        actor.effectiveRoleScopes
          .filter((scope) => scope.locationId && roles.has(scope.role))
          .map((scope) => scope.locationId!),
      ),
    ];
    return ids.length ? ids : undefined;
  }

  private materializedLocationIds(
    actor: AuthSession,
    roles: ReadonlySet<string>,
    allVisibleLocationIds: string[],
  ) {
    const allowed = this.allowedLocationIds(actor, roles);
    if (allowed === null) return allVisibleLocationIds;
    return allowed ?? [];
  }

  private async lockCommand(
    tx: Prisma.TransactionClient,
    actor: AuthSession,
    idempotencyKey: string,
  ) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`inventory:command:${actor.organizationId}:${actor.id}:${idempotencyKey}`}, 0))`,
    );
  }

  private async lockBalance(
    tx: Prisma.TransactionClient,
    organizationId: string,
    itemId: string,
    locationId: string,
  ) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`inventory:balance:${organizationId}:${itemId}:${locationId}`}, 0))`,
    );
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: INVENTORY_TRANSACTION_MAX_WAIT_MS,
          timeout: INVENTORY_TRANSACTION_TIMEOUT_MS,
        });
      } catch (error) {
        if (!this.isRetryableTransaction(error) || attempt === 2) throw error;
      }
    }
    throw new ConflictException("Inventory transaction could not be completed");
  }

  private isRetryableTransaction(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2034" ||
        (error.code === "P2010" && JSON.stringify(error.meta).includes("40001")) ||
        (error.code === "P2028" &&
          /expired transaction|transaction already closed|transaction.*timeout/i.test(
            error.message,
          )))
    );
  }

  private positiveQuantity(value: string) {
    const quantity = new Prisma.Decimal(value);
    if (!quantity.isPositive() || quantity.decimalPlaces() > 3) {
      throw new BadRequestException("Stock quantity must be positive with at most three decimals");
    }
    return quantity;
  }

  private nonnegativeQuantity(value: string) {
    const quantity = new Prisma.Decimal(value);
    if (quantity.isNegative() || quantity.decimalPlaces() > 3) {
      throw new BadRequestException("Stock quantity must be non-negative with at most three decimals");
    }
    return quantity;
  }

  private quantity(value: Prisma.Decimal | string) {
    return new Prisma.Decimal(value).toFixed(3);
  }

  private hash(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private assertReplay(storedHash: string, requestHash: string) {
    if (storedHash !== requestHash) {
      throw this.conflict(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used for different Inventory content.",
      );
    }
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  private mapMovement(movement: MovementWithDetails) {
    return {
      id: movement.id,
      item: movement.item,
      location: movement.location,
      lot: movement.lot
        ? {
            ...movement.lot,
            expiresAtIso: movement.lot.expiresAt?.toISOString() ?? null,
          }
        : null,
      supplier: movement.supplier,
      type: movement.type,
      quantityDelta: this.quantity(movement.quantityDelta),
      balanceBefore: this.quantity(movement.balanceBefore),
      balanceAfter: this.quantity(movement.balanceAfter),
      lotBalanceBefore: movement.lotBalanceBefore
        ? this.quantity(movement.lotBalanceBefore)
        : null,
      lotBalanceAfter: movement.lotBalanceAfter
        ? this.quantity(movement.lotBalanceAfter)
        : null,
      transferGroupId: movement.transferGroupId,
      sourceReference: movement.sourceReference,
      reason: movement.reason,
      occurredAtIso: movement.occurredAt.toISOString(),
      postedBy: movement.postedBy,
    };
  }

  private mapStocktake(stocktake: StocktakeWithDetails) {
    return {
      id: stocktake.id,
      item: stocktake.item,
      location: stocktake.location,
      lot: stocktake.lot,
      systemQuantity: this.quantity(stocktake.systemQuantity),
      countedQuantity: this.quantity(stocktake.countedQuantity),
      varianceQuantity: this.quantity(stocktake.varianceQuantity),
      reason: stocktake.reason,
      countedAtIso: stocktake.countedAt.toISOString(),
      movement: stocktake.movement ? this.mapMovement(stocktake.movement) : null,
      createdBy: stocktake.createdBy,
    };
  }

  private mapItemCommand(item: InventoryItem) {
    return {
      id: item.id,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      trackLots: item.trackLots,
      reorderPoint: this.quantity(item.reorderPoint),
      preferredStock: this.quantity(item.preferredStock),
      archivedAtIso: item.archivedAt?.toISOString() ?? null,
    };
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }
}
