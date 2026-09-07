import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const staffRoles = [
  "Owner",
  "Admin",
  "Manager",
  "Receptionist",
  "Scheduler",
  "Provider",
  "Assistant",
  "Finance",
  "InventoryManager",
] as const;
const staffStatuses = ["Active", "Invited", "Inactive", "Suspended"] as const;

export class StaffDirectoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100)
  limit = 25;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  @IsOptional()
  @IsIn(staffRoles)
  role?: (typeof staffRoles)[number];

  @IsOptional()
  @IsIn(staffStatuses)
  status?: (typeof staffStatuses)[number];

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsIn(["name", "role", "status", "lastLogin"])
  sort: "name" | "role" | "status" | "lastLogin" = "name";

  @IsOptional()
  @IsIn(["asc", "desc"])
  direction: "asc" | "desc" = "asc";
}
