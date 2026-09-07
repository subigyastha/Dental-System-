import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

const STOCK_QUANTITY = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/;
const POSITIVE_STOCK_QUANTITY = /^(?:0\.00[1-9]|0\.0[1-9]\d?|0\.[1-9]\d{0,2}|[1-9]\d{0,11}(?:\.\d{1,3})?)$/;
const CODE = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;

export class InventoryWorkspaceQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsIn(["active", "archived", "all"])
  lifecycle?: "active" | "archived" | "all";

  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;
}

export class InventoryMovementQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  itemId?: string;
}

export class CreateInventoryItemDto {
  @IsString()
  @Matches(CODE)
  sku!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsString()
  @Length(1, 24)
  unit!: string;

  @IsBoolean()
  trackLots!: boolean;

  @IsString()
  @Matches(STOCK_QUANTITY)
  reorderPoint!: string;

  @IsString()
  @Matches(STOCK_QUANTITY)
  preferredStock!: string;

  @IsOptional()
  @IsString()
  preferredSupplierId?: string;
}

export class UpdateInventoryItemDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(1, 24)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  trackLots?: boolean;

  @IsOptional()
  @IsString()
  @Matches(STOCK_QUANTITY)
  reorderPoint?: string;

  @IsOptional()
  @IsString()
  @Matches(STOCK_QUANTITY)
  preferredStock?: string;

  @IsOptional()
  @IsString()
  preferredSupplierId?: string;
}

export class CreateInventorySupplierDto {
  @IsString()
  @Matches(CODE)
  code!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReceiveInventoryStockDto {
  @IsString()
  itemId!: string;

  @IsString()
  locationId!: string;

  @IsString()
  @Matches(POSITIVE_STOCK_QUANTITY)
  quantity!: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lotNumber?: string;

  @IsOptional()
  @IsISO8601()
  expiresAtIso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceReference?: string;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class AdjustInventoryStockDto {
  @IsString()
  itemId!: string;

  @IsString()
  locationId!: string;

  @IsIn(["increase", "decrease"])
  direction!: "increase" | "decrease";

  @IsString()
  @Matches(POSITIVE_STOCK_QUANTITY)
  quantity!: string;

  @IsOptional()
  @IsString()
  lotId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceReference?: string;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class ConsumeInventoryStockDto {
  @IsString()
  itemId!: string;

  @IsString()
  locationId!: string;

  @IsString()
  @Matches(POSITIVE_STOCK_QUANTITY)
  quantity!: string;

  @IsOptional()
  @IsString()
  lotId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sourceReference?: string;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class InventoryStocktakeDto {
  @IsString()
  itemId!: string;

  @IsString()
  locationId!: string;

  @IsString()
  @Matches(STOCK_QUANTITY)
  countedQuantity!: string;

  @IsOptional()
  @IsString()
  lotId?: string;

  @IsOptional()
  @IsISO8601()
  countedAtIso?: string;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class TransferInventoryStockDto {
  @IsString()
  itemId!: string;

  @IsString()
  sourceLocationId!: string;

  @IsString()
  destinationLocationId!: string;

  @IsString()
  @Matches(POSITIVE_STOCK_QUANTITY)
  quantity!: string;

  @IsOptional()
  @IsString()
  sourceLotId?: string;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class ArchiveInventoryItemDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class RestoreInventoryItemDto extends ArchiveInventoryItemDto {}

export class PurgeInventoryItemDto {
  @IsString()
  @Length(1, 120)
  confirmation!: string;
}
