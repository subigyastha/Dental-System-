import { IsString } from "class-validator";

export class PurgeCustomerDto {
  @IsString()
  confirmCustomerId!: string;

  @IsString()
  reason!: string;
}
