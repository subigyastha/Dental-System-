import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
  ValidateNested,
} from "class-validator";

export class BookingConfirmationClientDto {
  @IsIn(["existing", "new"])
  mode!: "existing" | "new";

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  priorVisitedClinic?: boolean;

  @IsOptional()
  @IsBoolean()
  duplicateCheckAcknowledged?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  skippedPossibleMatchClientIds?: string[];

  @ValidateIf((input: BookingConfirmationClientDto) => input.mode === "new")
  @IsString()
  @Length(24, 24)
  candidateSetVersion?: string;
}

export class ConfirmBookingDto {
  @IsUUID()
  draftId!: string;

  @IsString()
  locationId!: string;

  @IsString()
  providerId!: string;

  @IsString()
  serviceId!: string;

  @IsISO8601()
  startsAtIso!: string;

  @IsIn(["Low", "Normal", "High", "Urgent"])
  priority!: "Low" | "Normal" | "High" | "Urgent";

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  holdId?: string;

  @ValidateNested()
  @Type(() => BookingConfirmationClientDto)
  client!: BookingConfirmationClientDto;
}
