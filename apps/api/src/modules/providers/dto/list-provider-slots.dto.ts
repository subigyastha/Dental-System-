import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

import { IsAdDateKey } from "../../scheduling/ad-date-key";

export class ListProviderSlotsDto {
  @IsString()
  organizationId!: string;

  @IsAdDateKey()
  date!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  excludeAppointmentId?: string;
}
