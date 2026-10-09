import { BadRequestException } from "@nestjs/common";
import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Length, Max, Min, IsDivisibleBy } from "class-validator";

/** A one-off procedure never creates or impersonates a catalog service. */
export class BookingProcedureDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  serviceId?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @Length(1, 120)
  customProcedureName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1440)
  @IsDivisibleBy(15)
  durationMinutes?: number;
}

export function assertBookingProcedure(input: BookingProcedureDto) {
  const custom = input.customProcedureName?.trim();
  if (Boolean(input.serviceId) === Boolean(custom) || (custom && custom.length > 120)) {
    throw new BadRequestException("Choose a catalog procedure or enter one custom procedure (up to 120 characters).");
  }
  if ((!input.serviceId && input.durationMinutes === undefined) ||
      (input.durationMinutes !== undefined && (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 1440 || input.durationMinutes % 15 !== 0))) {
    throw new BadRequestException("Duration must be 15-1440 minutes in 15-minute increments.");
  }
}
