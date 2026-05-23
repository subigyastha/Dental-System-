import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class AvailabilityWindowDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsString()
  startsAtLocal!: string;

  @IsString()
  endsAtLocal!: string;

  @IsInt()
  @Min(5)
  slotDurationMinutes!: number;

  @IsInt()
  @Min(0)
  bufferMinutes!: number;

  @IsBoolean()
  isActive!: boolean;
}

export class BlockedTimeDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsDateString()
  startsAtIso!: string;

  @IsDateString()
  endsAtIso!: string;

  @IsString()
  reason!: string;
}

export class RecurringBlockDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsString()
  startsAtLocal!: string;

  @IsString()
  endsAtLocal!: string;

  @IsString()
  reason!: string;

  @IsBoolean()
  isActive!: boolean;
}

export class UpdateProviderScheduleDto {
  @IsString()
  organizationId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  availability!: AvailabilityWindowDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BlockedTimeDto)
  blockedTimes!: BlockedTimeDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecurringBlockDto)
  recurringBlocks?: RecurringBlockDto[];
}
