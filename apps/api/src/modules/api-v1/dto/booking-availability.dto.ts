import { IsISO8601, IsString, IsUUID, Length } from "class-validator";

import { IsAdDateKey } from "../../scheduling/ad-date-key";

export class RankedAvailabilityQueryDto {
  @IsString()
  locationId!: string;

  @IsString()
  providerId!: string;

  @IsString()
  serviceId!: string;

  @IsAdDateKey()
  date!: string;
}

export class CreateBookingSlotHoldDto {
  @IsUUID()
  draftId!: string;

  @IsString()
  locationId!: string;

  @IsString()
  providerId!: string;

  @IsString()
  serviceId!: string;

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
