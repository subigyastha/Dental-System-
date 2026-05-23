import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpdateOrganizationDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsIn(["BS", "AD"])
  primaryCalendar!: "BS" | "AD";

  @IsString()
  businessDayStartsAt!: string;

  @IsString()
  businessDayEndsAt!: string;

  @IsInt()
  @Min(0)
  defaultBufferMinutes!: number;

  @IsInt()
  @Min(0)
  reminderLeadMinutes!: number;

  @IsBoolean()
  allowOverlaps!: boolean;
}
