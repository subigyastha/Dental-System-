import { IsOptional, IsString } from "class-validator";

/** A named appointment command's required business reason, where applicable. */
export class AppointmentLifecycleCommandDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
