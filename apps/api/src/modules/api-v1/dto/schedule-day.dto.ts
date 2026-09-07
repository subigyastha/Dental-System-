import { IsOptional, IsString, Matches } from "class-validator";

export class ScheduleDayDto {
  @IsString()
  organizationId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  providerIds?: string;
}
