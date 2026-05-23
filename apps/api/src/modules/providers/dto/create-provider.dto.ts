import { IsIn, IsOptional, IsString } from "class-validator";

export class CreateProviderDto {
  @IsString()
  organizationId!: string;

  @IsString()
  name!: string;

  @IsString()
  roleLabel!: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsIn(["Available", "Busy", "Away", "Inactive"])
  status?: "Available" | "Busy" | "Away" | "Inactive";
}
