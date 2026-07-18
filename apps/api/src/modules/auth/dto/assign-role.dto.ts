import { IsEnum, IsISO8601, IsOptional, IsString } from "class-validator";
import { UserRole } from "@prisma/client";

export class AssignRoleDto {
  @IsString()
  userId!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsISO8601()
  effectiveFromIso?: string;

  @IsOptional()
  @IsISO8601()
  effectiveToIso?: string;
}
