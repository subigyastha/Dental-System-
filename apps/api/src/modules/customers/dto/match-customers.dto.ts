import { IsOptional, IsString } from "class-validator";

export class MatchCustomersDto {
  @IsString()
  organizationId!: string;

  @IsString()
  name!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  email?: string;
}
