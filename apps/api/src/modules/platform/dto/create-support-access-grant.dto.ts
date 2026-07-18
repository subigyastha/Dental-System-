import { ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsOptional, IsString } from "class-validator";

export class CreateSupportAccessGrantDto {
  @IsString()
  organizationId!: string;

  @IsString()
  reason!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  dataDomains!: string[];

  @IsDateString()
  startsAtIso!: string;

  @IsDateString()
  expiresAtIso!: string;

  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}
