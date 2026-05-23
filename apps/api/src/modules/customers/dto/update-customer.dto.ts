import { IsString } from "class-validator";

import { CustomerBaseDto } from "./customer-base.dto";

export class UpdateCustomerDto extends CustomerBaseDto {
  @IsString()
  organizationId!: string;
}
