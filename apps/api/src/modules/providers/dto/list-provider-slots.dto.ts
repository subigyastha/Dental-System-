import { IsOptional, IsString } from "class-validator";

export class ListProviderSlotsDto {
  @IsString()
  organizationId!: string;

  @IsString()
  date!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsString()
  excludeAppointmentId?: string;
}
