import { IsOptional, IsString } from "class-validator";

export class ListProviderScheduleGridDto {
  @IsString()
  organizationId!: string;

  @IsString()
  dateIso!: string;

  @IsOptional()
  @IsString()
  locationId?: string;
}
