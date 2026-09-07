import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Matches,
  Min,
} from "class-validator";

export class ClientDirectoryQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsIn(["name", "recent"])
  order?: "name" | "recent";
}

export class ClientIdentityDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsString()
  @Length(7, 32)
  phone!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  gender?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "dateOfBirthIso must be an AD date in YYYY-MM-DD format",
  })
  dateOfBirthIso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @Length(7, 32)
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  allergies?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  medicalNotes?: string;

  @IsOptional()
  @IsIn(["Routine", "Needs attention", "High priority"])
  risk: "Routine" | "Needs attention" | "High priority" = "Routine";
}

export class CreateClientDto extends ClientIdentityDto {
  @IsString()
  @Length(24, 24)
  candidateSetVersion!: string;

  @IsOptional()
  @IsBoolean()
  duplicateCheckAcknowledged?: boolean;

  @IsOptional()
  @IsBoolean()
  priorVisitedClinic?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  skippedPossibleMatchClientIds?: string[];
}

export class MatchClientsDto {
  @IsString()
  name!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsISO8601()
  dateOfBirthIso?: string;
}

export class NumberFirstClientMatchDto {
  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class AppendClientPhoneDto {
  @IsString()
  phone!: string;

  @IsOptional()
  @IsIn(["Mobile", "Home", "Work", "Guardian", "Other"])
  type?: "Mobile" | "Home" | "Work" | "Guardian" | "Other";

  @IsOptional()
  @IsString()
  label?: string;

  @IsString()
  reason!: string;
}

export class AppendCallerPhoneDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsString()
  @Length(7, 32)
  phone!: string;

  @IsString()
  @Length(24, 24)
  candidateSetVersion!: string;

  @IsString()
  @Length(3, 240)
  reason!: string;
}

export class ClientIdentityReviewQueryDto {
  @IsOptional()
  @IsIn(["Pending", "InReview", "Resolved", "Dismissed"])
  status?: "Pending" | "InReview" | "Resolved" | "Dismissed";

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class ResolveClientIdentityReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsIn(["confirmed_existing", "confirmed_distinct", "false_signal"])
  resolution!: "confirmed_existing" | "confirmed_distinct" | "false_signal";

  @IsOptional()
  @IsString()
  resolvedClientId?: string;

  @IsString()
  reason!: string;
}

export class ArchiveClientDto {
  @IsString()
  reason!: string;
}

export class MergeClientDto {
  @IsString()
  secondaryClientId!: string;

  @IsString()
  reason!: string;
}
