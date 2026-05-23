import { IsEnum, IsOptional, IsString } from "class-validator";
import { AppointmentStatus } from "@prisma/client";

export class UpdateAppointmentStatusDto {
  @IsEnum(AppointmentStatus)
  status!: AppointmentStatus;

  @IsOptional()
  @IsString()
  note?: string;
}
