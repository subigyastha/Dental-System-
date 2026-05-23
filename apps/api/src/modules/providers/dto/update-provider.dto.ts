import { IsIn, IsOptional, IsString } from "class-validator";

export class UpdateProviderDto {
  @IsString()
  name!: string;

  @IsString()
  roleLabel!: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsString()
  color!: string;

  @IsIn(["Available", "Busy", "Away", "Inactive"])
  status!: "Available" | "Busy" | "Away" | "Inactive";
}
