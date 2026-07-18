import { IsBoolean, IsOptional, IsString } from "class-validator";

export class UpdateFeatureFlagDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
