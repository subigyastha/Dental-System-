import { IsString } from "class-validator";

export class MergeCustomerDto {
  @IsString()
  organizationId!: string;

  @IsString()
  secondaryCustomerId!: string;
}
