import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
} from "@nestjs/common";

import type { AuthSessionReference } from "../auth/auth.service";
import { ServiceSession } from "../auth/request-session";
import {
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
import { InventoryService } from "./inventory.service";
import { V1ExceptionFilter, v1Envelope } from "./v1-contract";

@Controller("v1/inventory")
@UseFilters(V1ExceptionFilter)
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  @Get("workspace")
  async workspace(
    @Query() query: InventoryWorkspaceQueryDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.inventory.workspace(query, authorization),
      request.requestId,
    );
  }

  @Get("movements")
  async movements(
    @Query() query: InventoryMovementQueryDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.inventory.movementHistory(query, authorization),
      request.requestId,
    );
  }

  @Post("items")
  async createItem(
    @Body() dto: CreateInventoryItemDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.inventory.createItem(dto, authorization),
      request.requestId,
    );
  }

  @Post("suppliers")
  async createSupplier(
    @Body() dto: CreateInventorySupplierDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.inventory.createSupplier(dto, authorization),
      request.requestId,
    );
  }

  @Patch("items/:id")
  async updateItem(
    @Param("id") id: string,
    @Body() dto: UpdateInventoryItemDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.inventory.updateItem(id, dto, authorization),
      request.requestId,
    );
  }

  @Post("receive")
  async receive(
    @Body() dto: ReceiveInventoryStockDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return v1Envelope(
      await this.inventory.receive(dto, idempotencyKey, authorization),
      request.requestId,
    );
  }

  @Post("consume")
  async consume(
    @Body() dto: ConsumeInventoryStockDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return v1Envelope(
      await this.inventory.consume(dto, idempotencyKey, authorization),
      request.requestId,
    );
  }

  @Post("adjustments")
  async adjust(
    @Body() dto: AdjustInventoryStockDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return v1Envelope(
      await this.inventory.adjust(dto, idempotencyKey, authorization),
      request.requestId,
    );
  }

  @Post("stocktakes")
  async stocktake(
    @Body() dto: InventoryStocktakeDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return v1Envelope(
      await this.inventory.stocktake(dto, idempotencyKey, authorization),
      request.requestId,
    );
  }

  @Post("transfers")
  async transfer(
    @Body() dto: TransferInventoryStockDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return v1Envelope(
      await this.inventory.transfer(dto, idempotencyKey, authorization),
      request.requestId,
    );
  }

  @Post("items/:id/archive")
  async archiveItem(
    @Param("id") id: string,
    @Body() dto: ArchiveInventoryItemDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.inventory.archiveItem(id, dto, authorization),
      request.requestId,
    );
  }

  @Post("items/:id/restore")
  async restoreItem(
    @Param("id") id: string,
    @Body() dto: RestoreInventoryItemDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.inventory.restoreItem(id, dto, authorization),
      request.requestId,
    );
  }

  @Delete("items/:id/purge")
  async purgeItem(
    @Param("id") id: string,
    @Body() dto: PurgeInventoryItemDto,
    @Req() request: { requestId?: string },
    @ServiceSession() authorization?: AuthSessionReference,
  ) {
    return v1Envelope(
      await this.inventory.purgeItem(id, dto, authorization),
      request.requestId,
    );
  }

  private assertIdempotencyKey(value: string | undefined): asserts value is string {
    if (!value || value.length < 16 || value.length > 100) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_INVALID",
        message: "Idempotency-Key must be between 16 and 100 characters.",
      });
    }
  }
}
