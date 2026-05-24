import { IsOptional, IsString } from "class-validator";

export class ListProviderScheduleGridsDto {
  @IsString()
  organizationId!: string;

  @IsString()
  dateIso!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  providerIds?: string;
}
