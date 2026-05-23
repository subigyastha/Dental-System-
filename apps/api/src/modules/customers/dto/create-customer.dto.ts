import { IsOptional, IsString } from "class-validator";

import { CustomerBaseDto } from "./customer-base.dto";

export class CreateCustomerDto extends CustomerBaseDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  organizationId!: string;
}
