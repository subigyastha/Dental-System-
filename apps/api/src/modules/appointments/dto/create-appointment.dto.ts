import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Priority } from "@prisma/client";

export class CreateAppointmentDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  holdId?: string;

  @IsString()
  organizationId!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsString()
  customerId!: string;

  @IsString()
  providerId!: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsArray()
  @IsString({ each: true })
  serviceIds!: string[];

  @IsString()
  startsAtIso!: string;

  @IsInt()
  @Min(1)
  durationMinutes!: number;

  @IsInt()
  @Min(0)
  bufferMinutes!: number;

  @IsEnum(Priority)
  priority!: Priority;

  @IsOptional()
  @IsString()
  chair?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
