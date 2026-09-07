import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  IsInt,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { PaymentMethod } from "@prisma/client";

import { IsAdDateKey } from "../../scheduling/ad-date-key";

const NPR_AMOUNT = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;

export class FinanceInvoiceLineDto {
  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsString()
  @Length(1, 240)
  description!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @Matches(NPR_AMOUNT)
  unitPriceNpr!: string;

  @IsOptional()
  @IsString()
  @Matches(NPR_AMOUNT)
  discountNpr?: string;

  @IsOptional()
  @IsString()
  @Matches(NPR_AMOUNT)
  taxNpr?: string;
}

export class CreateFinanceInvoiceDto {
  @IsString()
  locationId!: string;

  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsOptional()
  @IsISO8601()
  dueAtIso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FinanceInvoiceLineDto)
  lineItems!: FinanceInvoiceLineDto[];
}

export class FinanceWorkspaceQueryDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;
}

export class RecordFinancePaymentDto {
  @IsString()
  locationId!: string;

  @IsString()
  @Matches(NPR_AMOUNT)
  amountNpr!: string;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsISO8601()
  paidAtIso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateFinanceCorrectionDto {
  @IsString()
  @Matches(NPR_AMOUNT)
  amountNpr!: string;

  @IsIn(["Refund", "Reversal"])
  kind!: "Refund" | "Reversal";

  @IsString()
  @Length(3, 500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  providerReference?: string;
}

export class ApproveFinanceCorrectionDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RejectFinanceCorrectionDto extends ApproveFinanceCorrectionDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class FinanceCorrectionQueryDto {
  @IsOptional()
  @IsIn(["PendingApproval", "Executed", "Rejected"])
  status?: "PendingApproval" | "Executed" | "Rejected";

  @IsOptional()
  @IsString()
  locationId?: string;
}

export class FinanceReconciliationQueryDto {
  @IsAdDateKey()
  date!: string;

  @IsOptional()
  @IsString()
  locationId?: string;
}

export class FinanceIdempotencyDto {
  @IsString()
  @Length(16, 100)
  idempotencyKey!: string;
}
