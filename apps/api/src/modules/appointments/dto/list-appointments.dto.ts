import { IsIn, IsOptional, IsString } from "class-validator";

export class ListAppointmentsDto {
  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  fromIso?: string;

  @IsOptional()
  @IsString()
  toIso?: string;

  @IsOptional()
  @IsIn([
    "Scheduled",
    "Confirmed",
    "CheckedIn",
    "InProgress",
    "Completed",
    "Cancelled",
    "NoShow",
    "Rescheduled",
    "FollowUpRequired",
  ])
  status?: string;
}
