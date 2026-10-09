import { BookingProcedureDto } from "./booking-procedure.dto";
import { IsISO8601, IsString, IsUUID, Length } from "class-validator";

import { IsAdDateKey } from "../../scheduling/ad-date-key";

export class RankedAvailabilityQueryDto extends BookingProcedureDto {
  @IsString()
  locationId!: string;

  @IsString()
  providerId!: string;

  @IsAdDateKey()
  date!: string;
}

export class CreateBookingSlotHoldDto extends BookingProcedureDto {
  @IsUUID()
  draftId!: string;

  @IsString()
  locationId!: string;

  @IsString()
  providerId!: string;

  @IsISO8601()
  startsAtIso!: string;

  @IsString()
  @Length(20, 20)
  slotId!: string;

  @IsString()
  @Length(24, 24)
  availabilityVersion!: string;

  @IsString()
  @Length(16, 100)
  idempotencyKey!: string;
}
