import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export class UpdateClinicSettingsDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @Matches(clockTime)
  businessDayStartsAt!: string;

  @Matches(clockTime)
  businessDayEndsAt!: string;

  @IsInt()
  @Min(0)
  @Max(240)
  defaultBufferMinutes!: number;

  @IsInt()
  @Min(1)
  @Max(10)
  bookingHoldMinutes!: number;

  @IsIn([5, 10, 15, 20, 30, 60])
  slotStartIntervalMinutes!: 5 | 10 | 15 | 20 | 30 | 60;

  @IsInt()
  @Min(0)
  @Max(10080)
  reminderLeadMinutes!: number;
}
