import { IsString } from "class-validator";

import { CreateAppointmentDto } from "./create-appointment.dto";

/** A new validated successor; the original appointment is never overwritten. */
export class RescheduleAppointmentDto extends CreateAppointmentDto {
  @IsString()
  reason!: string;
}
