import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export const staffRoles = [
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

export class StaffBaseDto {
  @IsString()
  organizationId!: string;

  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsIn(staffRoles)
  role!: (typeof staffRoles)[number];

  @IsString()
  staffLabel!: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  employmentType?: string;

  @IsOptional()
  @IsDateString()
  startDateIso?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsIn(["Active", "Inactive", "Invited", "Suspended"])
  status!: "Active" | "Inactive" | "Invited" | "Suspended";

  @IsBoolean()
  isSchedulable!: boolean;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsIn(["Available", "Busy", "Away", "Inactive"])
  providerStatus?: "Available" | "Busy" | "Away" | "Inactive";
}

export class PasswordDto {
  @IsString()
  @MinLength(15)
  password!: string;
}
