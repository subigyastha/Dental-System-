import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from "class-validator";

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

export class UpdateProviderAvailabilityDto {
  @IsString()
  organizationId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  availability!: AvailabilityWindowDto[];
}
